// Upgrades a CS 1.x demo recorded with network protocol 44-47 so today's CS 1.6 (protocol 48) can play it.
// Protocol 47 demos (2003-2007 Steam CS 1.6) already have CS 1.6's messages and layouts: only the protocol number and
// the server info's extra block change; the CS 1.5 -> 1.6 rules apply to protocol 44-46 only.
// Each change is a small named rule; the report counts how often each one was applied.
// Format differences are documented in docs/FORMAT.md ("Protocol 46 vs 48").
import { FrameType, type DemoFile, type Frame, type NetFrame, type Section } from '../container/types.js';
import { encodeBaseline, encodeClientData, encodeDirector, encodeEntities, encodeResourceList, encodeServerInfo, encodeUserMessage, encodeVoiceInit } from '../protocol/encode.js';
import { createState, decodeMessages, encodeMessages, type Message, type ProtocolState } from '../protocol/messages.js';
import { Svc } from '../protocol/ids.js';
import type { DeltaDescriptor, DeltaRecord } from '../protocol/delta.js';

export const TARGET_PROTOCOL = 48;

export interface UpgradeOptions {
  /** Returns true when a resource (e.g. "sprites/top.spr") does not exist in the player's game. Such entries are dropped. */
  isResourceMissing?: (name: string) => boolean;
  /** Speex quality value written into svc_voiceinit (protocol 47+ requires one). */
  voiceQuality?: number;
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

/** CS 1.6 added shield animations to the player model, moving player sequences 83+ up by 16 (CS 1.1-1.5 demos). */
export function upgradePlayerSequence(sequence: number): number {
  return sequence >= 83 ? sequence + 16 : sequence;
}

class Upgrade {
  readonly applied: Record<string, number> = {};
  readonly warnings: string[] = [];
  sawDirector = false;

  /** True for demos from before CS 1.6 (protocol 44-46): the CS 1.5 -> 1.6 layout rules apply. */
  private readonly old: boolean;

  constructor(private readonly state: ProtocolState, private readonly opts: UpgradeOptions) {
    this.old = state.protocol < 47 && !state.betaSteam;
  }

  private count(rule: string): void {
    this.applied[rule] = (this.applied[rule] ?? 0) + 1;
  }

  private fixSequences(descriptorName: string, record: DeltaRecord): DeltaRecord | undefined {
    if (!this.old || descriptorName !== 'entity_state_player_t') return undefined;
    const d = this.state.deltas.get(descriptorName) as DeltaDescriptor;
    let out = record;
    for (const field of ['sequence', 'gaitsequence']) {
      const v = d.getInteger(out, field);
      if (v !== undefined && upgradePlayerSequence(v) !== v) out = d.withInteger(out, field, upgradePlayerSequence(v));
    }
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
        this.count('server info: protocol 48');
        return [{ ...m, bytes: encodeServerInfo(b, { protocol: TARGET_PROTOCOL, extra: Uint8Array.of(0) }) }];
      case 'voiceInit':
        if (b.quality !== undefined) return [m];
        this.count('voice init: add quality byte');
        return [{ ...m, bytes: encodeVoiceInit(b.codec, this.opts.voiceQuality ?? 5) }];
      case 'clientData':
        if (s.weaponIndexBits === 6) return [m];
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
        const missing = this.opts.isResourceMissing;
        const resources = missing ? b.resources.filter((r) => !missing(r.name)) : b.resources;
        const dropped = b.resources.length - resources.length;
        if (dropped) this.warnings.push(`Removed ${dropped} resources that don't exist in the current game.`);
        if (!dropped && !b.hadConsistencyList) return [m];
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
            const next = upgradePlayerSequence(seq);
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
  if (P < 44 || P > 47) throw new UnsupportedDemoError(`Network protocol ${P} is not supported yet (supported: 44-47).`);
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
      let out = messages.flatMap((m) => up.rewrite(m));
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
      frames.push({ ...f, messages: encodeMessages(f.messages, out) });
    });
    sections.push({ entry: section.entry, frames });
  });

  return {
    demo: { ...demo, header: { ...demo.header, networkProtocol: TARGET_PROTOCOL }, sections },
    report: { sourceProtocol: P, applied: up.applied, warnings: up.warnings },
  };
}
