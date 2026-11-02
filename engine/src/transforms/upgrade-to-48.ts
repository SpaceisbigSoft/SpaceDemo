// Upgrades a CS 1.x demo recorded with network protocol 43-47 so today's CS 1.6 (protocol 48) can play it.
// Protocol 43 (CS 1.0-1.2, 2000-2001) additionally needs: its bit-packed messages re-written LSB-first (decoder's
// `lsb`), a host name in the server info, a CD key hash in each user info, the frame info block cut from 560 to 464
// bytes, and (CS 1.0) its own player animation numbering. Facts checked against COL's converter (reference only).
// Protocol 47 demos (2003-2007 Steam CS 1.6) already have CS 1.6's messages and layouts: only the protocol number and
// the server info's extra block change; the CS 1.5 -> 1.6 rules apply to protocol 44-46 only.
// Each change is a small named rule; the report counts how often each one was applied.
// Format differences are documented in docs/FORMAT.md ("Protocol 46 vs 48").
import { FrameType, type DemoFile, type Frame, type NetFrame, type Section } from '../container/types.js';
import { encodeBaseline, encodeClientData, encodeDirector, encodeEntities, encodeEvents, encodeResourceList, encodeServerInfo, encodeUserMessage, encodeVoiceInit } from '../protocol/encode.js';
import { createState, decodeMessages, encodeMessages, type Message, type ProtocolState } from '../protocol/messages.js';
import { Svc } from '../protocol/ids.js';
import type { DeltaDescriptor, DeltaRecord } from '../protocol/delta.js';

export const TARGET_PROTOCOL = 48;

export interface UpgradeOptions {
  /** Returns true when a resource (e.g. "sprites/top.spr") does not exist in the player's game. Such entries are dropped. */
  isResourceMissing?: (name: string) => boolean;
  /** Speex quality value written into svc_voiceinit (protocol 47+ requires one). */
  voiceQuality?: number;
  /**
   * 0.8 old maps: play the demo on a copy of its old map saved under this name (e.g. "de_nuke_0x7a05c3a"), because
   * the stock map of the same name is today's version and must not be replaced. Renames the map in the header, the
   * server info and the resource list (the world model); the checksum stays (it doesn't include the name).
   */
  mapName?: string;
}

export interface UpgradeReport {
  sourceProtocol: number;
  /** How many times each rule changed something. */
  applied: Record<string, number>;
  warnings: string[];
}

export class UnsupportedDemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDemoError';
  }
}

const isNet = (f: Frame): f is NetFrame => f.type === FrameType.NetMessages || f.type === FrameType.NetMessagesLoading;

/**
 * CS 1.6 added shield animations to the player model, moving player sequences 83+ up by 16 (CS 1.1-1.5 demos).
 * CS 1.0's player model also lacks the "dummy" animation (0-6 → 1-7) and the swim/tread-water ones (7-79 → +3),
 * so everything from 80 on moves by 19 (COL's mapping, reference only).
 */
export function upgradePlayerSequence(sequence: number, cs10 = false): number {
  if (cs10) return sequence <= 6 ? sequence + 1 : sequence <= 79 ? sequence + 3 : sequence + 19;
  return sequence >= 83 ? sequence + 16 : sequence;
}

/**
 * client.dll hashes (svc_serverinfo) of CS 1.0 (Old CS Lab, 2026-11-01). Other CS 1.0 builds are recognised by their
 * user messages: CS 1.1 added AllowSpec, CS 1.0 doesn't register it.
 */
const CS10_CLIENT_HASHES = new Set(['7c8346efe2629d87a50a94bef682034d']);
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Protocol 43 frame info block (560 bytes: 532 view info + 28 sequence info) → protocol 44+ (464 = 436 + 28).
 * Measured on the Old CS Lab demos against CS 1.3/1.4 ones (2026-11-01): timestamp and ref_params are the same up
 * to byte 212 (origin, angles, velocity, health...); protocol 43's ref_params lack the last 24 bytes, so its user
 * command (52 bytes, buttons at +30) starts at 212 instead of 236; the view vector and view model are at 516 (420 in
 * 44+). Movevars (not mapped) and the missing ref_params tail are zeros; COL keeps even less (first 28 bytes).
 */
export function convertInfo43(info: Uint8Array): Uint8Array {
  if (info.length !== 560) return info;
  const out = new Uint8Array(464);
  out.set(info.subarray(0, 212), 0);
  out.set(info.subarray(212, 264), 236);
  out.set(info.subarray(516, 532), 420);
  out.set(info.subarray(532, 560), 436);
  return out;
}

class Upgrade {
  readonly applied: Record<string, number> = {};
  readonly warnings: string[] = [];
  sawDirector = false;
  /** The current frame's original message bytes (for rules that copy a message and append to it). */
  source?: Uint8Array;
  /** The world model name from the server info ("maps/de_nuke.bsp"), when the map is renamed. */
  oldWorld?: string;

  /** True for demos from before CS 1.6 (protocol 43-46): the CS 1.5 -> 1.6 layout rules apply. */
  private readonly old: boolean;
  /** Protocol 43 (CS 1.0-1.2). */
  private readonly p43: boolean;
  private cs10Hash = false;
  /** CS 1.0: its own player animation numbering. */
  get cs10(): boolean {
    if (!this.p43) return false;
    return this.cs10Hash || ![...this.state.userMessages.values()].some((u) => u.name === 'AllowSpec');
  }
  /** CS 1.0/1.1 (protocol 43 without events/decal_reset.sc, which came with newer clients), from the resource list. */
  private cs10or11 = false;
  /** CS 1.0/1.1 smoke grenades: index of events/createsmoke.sc (from the resource list). */
  private smokeEvent?: number;

  constructor(private readonly state: ProtocolState, private readonly opts: UpgradeOptions) {
    this.old = state.protocol < 47 && !state.betaSteam;
    this.p43 = state.protocol <= 43;
  }

  /** Protocol 43: messages a rule left unchanged are still written in the new bit order. */
  rewriteAll(m: Message): Message[] {
    return this.rewrite(m).map((x) => (x === m && m.lsb ? (this.count('protocol 43: bit order'), { ...m, bytes: m.lsb }) : x));
  }

  private count(rule: string): void {
    this.applied[rule] = (this.applied[rule] ?? 0) + 1;
  }

  private fixSequences(descriptorName: string, record: DeltaRecord): DeltaRecord | undefined {
    if (!this.old) return undefined;
    const d = this.state.deltas.get(descriptorName) as DeltaDescriptor;
    let out = record;
    if (descriptorName === 'entity_state_player_t') {
      for (const field of ['sequence', 'gaitsequence']) {
        const v = d.getInteger(out, field);
        const next = v === undefined ? v : upgradePlayerSequence(v, this.cs10);
        if (v !== undefined && next !== v) out = d.withInteger(out, field, next!);
      }
    }
    // CS 1.0/1.1 (protocol 43): animation times are zeroed (COL; otherwise models animate wrongly).
    if (this.cs10or11) out = d.withZero(out, 'animtime');
    return out === record ? undefined : out;
  }

  /** Returns the message(s) to write in place of `m` (empty array = remove it). */
  rewrite(m: Message): Message[] {
    const b = m.body;
    const s = this.state;
    if (m.id === Svc.Director) this.sawDirector = true;
    if (!b) return [m];
    switch (b.kind) {
      case 'serverInfo':
        // Protocol number 48; the protocol-46 extra-info block (flag + 21 bytes) is replaced by "no extra info".
        // Protocol 43 has no host name (encoded as an empty one) and no extra block.
        this.count('server info: protocol 48');
        if (this.p43) this.cs10Hash = CS10_CLIENT_HASHES.has(hex(b.clientDllHash));
        if (this.opts.mapName) {
          this.oldWorld = b.mapName.toLowerCase().replace(/\\/g, '/');
          this.count('map renamed');
          return [{ ...m, bytes: encodeServerInfo({ ...b, mapName: `maps/${this.opts.mapName}.bsp` }, { protocol: TARGET_PROTOCOL, extra: Uint8Array.of(0) }) }];
        }
        return [{ ...m, bytes: encodeServerInfo(b, { protocol: TARGET_PROTOCOL, extra: Uint8Array.of(0) }) }];
      case 'userInfo': {
        if (!this.p43 || m.start === undefined || m.end === undefined || !this.source) return [m];
        // Protocol 44+ appends a 16-byte CD key hash; old demos have none, so it's zeros.
        this.count('protocol 43: user info hash');
        const old = this.source.subarray(m.start, m.end);
        const bytes = new Uint8Array(old.length + 16);
        bytes.set(old);
        return [{ ...m, bytes }];
      }
      case 'events': {
        if (this.smokeEvent === undefined || !this.p43) return [m];
        // CS 1.0/1.1 smoke grenades: the smoke event's iparam1 isn't what today's client expects (COL sets a guessed
        // size); without it the smoke cloud doesn't show. 200 is within COL's range.
        const ev = s.deltas.get('event_t');
        if (!ev) return [m];
        let changed = false;
        const events = b.events.map((e) => {
          if (e.index !== this.smokeEvent || !e.record || ev.getInteger(e.record, 'iparam1') === undefined) return e;
          changed = true;
          return { ...e, record: ev.withInteger(e.record, 'iparam1', 200) };
        });
        if (!changed) return [m];
        this.count('CS 1.0/1.1 smoke size');
        return [{ ...m, bytes: encodeEvents({ ...b, events }, s.deltas) }];
      }
      case 'voiceInit':
        if (b.quality !== undefined) return [m];
        this.count('voice init: add quality byte');
        return [{ ...m, bytes: encodeVoiceInit(b.codec, this.opts.voiceQuality ?? 5) }];
      case 'clientData':
        if (s.weaponIndexBits === 6 && !this.p43) return [m];
        this.count('client data: 6-bit weapon index');
        return [{ ...m, bytes: encodeClientData(b, s.deltas, 6) }];
      case 'entities': {
        let changed = false;
        const entities = b.entities.map((e) => {
          const fixed = e.record && this.fixSequences(e.descriptor, e.record);
          if (!fixed) return e;
          changed = true;
          return { ...e, record: fixed };
        });
        if (!changed) return [m];
        this.count('player animation numbers');
        return [{ ...m, bytes: encodeEntities({ ...b, entities }, s.deltas) }];
      }
      case 'baseline': {
        let changed = false;
        const entities = b.entities.map((e) => {
          const fixed = this.fixSequences(e.descriptor, e.record);
          if (!fixed) return e;
          changed = true;
          return { ...e, record: fixed };
        });
        if (!changed) return [m];
        this.count('player animation numbers (baseline)');
        return [{ ...m, bytes: encodeBaseline({ ...b, entities }, s.deltas) }];
      }
      case 'resourceList': {
        if (this.p43) {
          this.cs10or11 = !b.resources.some((r) => r.name === 'events/decal_reset.sc');
          const smoke = b.resources.find((r) => r.type === 5 && r.name === 'events/createsmoke.sc');
          this.smokeEvent = this.cs10or11 ? smoke?.index : undefined;
        }
        const missing = this.opts.isResourceMissing;
        let resources = missing ? b.resources.filter((r) => !missing(r.name)) : b.resources;
        const dropped = b.resources.length - resources.length;
        if (dropped) this.warnings.push(`Removed ${dropped} resources that don't exist in the current game.`);
        let renamed = false;
        if (this.opts.mapName && this.oldWorld) {
          const world = `maps/${this.opts.mapName}.bsp`;
          resources = resources.map((r) => (r.name.toLowerCase().replace(/\\/g, '/') === this.oldWorld ? ((renamed = true), { ...r, name: world }) : r));
        }
        if (!dropped && !renamed && !b.hadConsistencyList && !this.p43) return [m];
        this.count('resource list');
        return [{ ...m, bytes: encodeResourceList({ ...b, resources }) }];
      }
      case 'hltv':
        if (b.command !== 2) return [m];
        this.count('remove old HLTV multicast message');
        return [];
      case 'newUserMsg':
        if (b.def.name === 'CDChallenge' || b.def.name === 'CDSalt') {
          this.count('remove Cheating-Death messages');
          return [];
        }
        return [m];
      case 'user':
        switch (b.name) {
          case 'CDChallenge':
          case 'CDSalt':
            this.count('remove Cheating-Death messages');
            return [];
          case 'SendAudio': {
            // CS 1.6 appends a pitch (short); 100 = normal. Protocol 47 demos already have it.
            if (!this.old) return [m];
            this.count('radio audio: add pitch');
            const payload = new Uint8Array(b.payload.length + 2);
            payload.set(b.payload);
            payload.set([100, 0], b.payload.length);
            return [{ ...m, bytes: encodeUserMessage(m.id, payload, b.sized) }];
          }
          case 'ClCorpse': {
            if (!this.old) return [m];
            // Layout: model name (string), origin (3 x i32), angles (3 x i16), delay (i32), sequence (byte), ...
            const end = b.payload.indexOf(0);
            const at = end + 1 + 22;
            if (end < 0 || at >= b.payload.length) return [m];
            const seq = b.payload[at];
            const next = upgradePlayerSequence(seq, this.cs10);
            if (next === seq || next > 255) return [m];
            const payload = b.payload.slice();
            payload[at] = next;
            this.count('corpse animation number');
            return [{ ...m, bytes: encodeUserMessage(m.id, payload, b.sized) }];
          }
        }
        return [m];
      default:
        return [m];
    }
  }
}

/** Index of the last loading frame that starts a map (svc_serverinfo); earlier frames belong to previous maps. */
function lastMapStart(section: Section, state: ProtocolState): number {
  let last = 0;
  section.frames.forEach((f, i) => {
    if (!isNet(f)) return;
    try {
      if (decodeMessages(f.messages, state).some((m) => m.id === Svc.ServerInfo)) last = i;
    } catch {
      /* reported by the main pass */
    }
  });
  return last;
}

export function upgradeTo48(demo: DemoFile, options: UpgradeOptions = {}): { demo: DemoFile; report: UpgradeReport } {
  const P = demo.header.networkProtocol;
  if (P === TARGET_PROTOCOL) throw new UnsupportedDemoError('This demo already uses protocol 48.');
  if (P < 43 || P > 47) throw new UnsupportedDemoError(`Network protocol ${P} is not supported yet (supported: 43-47).`);
  if (demo.header.gameDir !== 'cstrike') throw new UnsupportedDemoError(`Only Counter-Strike demos are supported (this one is "${demo.header.gameDir}").`);
  if (demo.sections.length < 2) throw new UnsupportedDemoError('The demo has no playback section.');

  const state = createState(P, demo.header.gameDir);
  const up = new Upgrade(state, options);
  const sections: Section[] = [];

  // Loading section: keep only the last map load (fixes demos that load the wrong map first).
  const loading = demo.sections[0];
  const firstKept = lastMapStart(loading, createState(P, demo.header.gameDir));
  if (firstKept > 0) up.warnings.push(`Skipped ${firstKept} loading frames from an earlier map.`);

  let insertedDirector = false;
  demo.sections.forEach((section, si) => {
    const frames: Frame[] = [];
    section.frames.forEach((f, fi) => {
      const keep = si !== 0 || fi >= firstKept;
      if (!isNet(f)) {
        if (keep) frames.push(f);
        return;
      }
      // Decode every frame (even skipped ones) so the protocol state stays complete.
      let messages: Message[];
      try {
        messages = decodeMessages(f.messages, state);
      } catch (e) {
        up.warnings.push(`Frame ${f.index} at ${f.time.toFixed(2)}s could not be read and was left out: ${(e as Error).message}`);
        return;
      }
      if (!keep) return;
      up.source = f.messages;
      let out = messages.flatMap((m) => up.rewriteAll(m));
      if (si > 0 && !insertedDirector && f.type === FrameType.NetMessages) {
        insertedDirector = true;
        if (state.hltv && !up.sawDirector) {
          // Old HLTV demos lack the director messages that start the spectator HUD and select first-person view.
          out = [
            { id: Svc.Director, name: 'Director', bytes: encodeDirector(Uint8Array.of(1)) },
            { id: Svc.Director, name: 'Director', bytes: encodeDirector(Uint8Array.of(3, 4)) },
            ...out,
          ];
          up.applied['HLTV: start spectator HUD'] = 1;
        }
      }
      frames.push({ ...f, ...(P <= 43 ? { info: convertInfo43(f.info) } : {}), messages: encodeMessages(f.messages, out) });
    });
    sections.push({ entry: section.entry, frames });
  });

  return {
    demo: { ...demo, header: { ...demo.header, networkProtocol: TARGET_PROTOCOL, ...(options.mapName ? { mapName: options.mapName } : {}) }, sections },
    report: { sourceProtocol: P, applied: up.applied, warnings: up.warnings },
  };
}
