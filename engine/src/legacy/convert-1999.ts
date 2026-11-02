// Converts a 1999 demo (demo format 4, network protocol 39-40: Half-Life 1.0.1.3/1.0.1.6, CS betas 1.0-6.2) into a
// protocol-48 demo today's CS 1.6 can play (plan F4). Unlike the 41-47 upgrade, every bit-packed message is rebuilt:
//   - the frame layout changes (view + sequence + net frames → one net frame with a 464-byte info block, plus a
//     client-data frame), and the 8-byte netchan header is dropped;
//   - protocol 48's delta descriptions (delta48.ts) are sent after the server info;
//   - players (svc_playerinfo) become entities 1..maxclients in svc_packetentities, written with those descriptions
//     together with the other entities (each against its baseline), and the recorder's svc_clientdata is rebuilt;
//   - sounds, baselines, the resource list (sent in pieces in 1999), movevars, user info and the server info get
//     protocol 48's layouts; message ids that moved are renumbered; messages today's engine lacks are dropped.
// Facts: docs/FORMAT.md ("Protocol 38-40") and Logs\CS Demo Fixer F4 1999 Notes.md.
import { BitWriter } from '../binary/bits.js';
import { FrameType, type DemoFile, type DemoHeader, type Frame, type Section } from '../container/types.js';
import { encodeEntities, encodeNewUserMsg, encodeResourceList, encodeServerInfo, encodeUserMessage } from '../protocol/encode.js';
import { Svc } from '../protocol/ids.js';
import type { PacketEntity, Resource } from '../protocol/messages.js';
import type { UpgradeReport } from '../transforms/upgrade-to-48.js';
import { deltaRecord, descriptors48, encodeDeltaDescriptions48, type Values48 } from './delta48.js';
import { Frame4Type, readDemo4, type Demo4, type NetFrame4 } from './format4.js';
import { cloneEnt40, createState40, decodeMessages40, emptyEnt40, P40, type ClientData40, type EntState40, type Message40, type PlayerState40, type Resource40 } from './p40.js';

export interface Convert1999Options {
  /** Returns true when a resource does not exist in the player's game (such models and sprites are dropped). */
  isResourceMissing?: (name: string) => boolean;
  /** Play on a copy of the old map saved under this name (see UpgradeOptions.mapName). */
  mapName?: string;
}

/** Messages copied unchanged (same layout) under protocol 48's id. Ids not listed and not handled are dropped. */
const SAME_LAYOUT: Partial<Record<number, number>> = {
  [P40.Nop]: Svc.Nop, [P40.Disconnect]: Svc.Disconnect, [P40.Version]: Svc.Version, [P40.SetView]: Svc.SetView,
  [P40.Time]: Svc.Time, [P40.Print]: Svc.Print, [P40.StuffText]: Svc.StuffText, [P40.SetAngle]: Svc.SetAngle,
  [P40.LightStyle]: Svc.LightStyle, [P40.StopSound]: Svc.StopSound, [P40.Particle]: Svc.Particle, [P40.TempEntity]: Svc.TempEntity,
  [P40.SetPause]: Svc.SetPause, [P40.SignOnNum]: Svc.SignOnNum, [P40.CenterPrint]: Svc.CenterPrint,
  [P40.SpawnStaticSound]: Svc.SpawnStaticSound, [P40.Intermission]: Svc.Intermission, [P40.Finale]: Svc.Finale,
  [P40.CdTrack]: Svc.CdTrack, [P40.WeaponAnim]: Svc.WeaponAnim, [P40.RoomType]: Svc.RoomType, [P40.AddAngle]: Svc.AddAngle,
  [P40.Choke]: Svc.Choke, [P40.ResourceRequest]: Svc.ResourceRequest, [P40.CrosshairAngle]: Svc.CrosshairAngle,
  [P40.SoundFade]: Svc.SoundFade,
};

const FL_ONGROUND = 1 << 9;
const FL_DUCKING = 1 << 14;
const FL_CLIENT = 1 << 3;

function writeCoord(w: BitWriter, v: number): void {
  const a = Math.abs(v);
  let whole = Math.floor(a);
  let frac = Math.round((a - whole) * 8);
  if (frac === 8) { whole++; frac = 0; }
  whole = Math.min(whole, 4095);
  w.bool(whole > 0);
  w.bool(frac > 0);
  if (!whole && !frac) return;
  w.bool(v < 0);
  if (whole) w.bits(whole, 12);
  if (frac) w.bits(frac, 3);
}

/** svc_sound in protocol 48's layout (LSB-first bits; position as a bit-packed vector). */
export function encodeSound48(s: { flags: number; volume?: number; attenuation?: number; channel: number; entity: number; index: number; origin: [number, number, number]; pitch?: number }): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.Sound);
  let flags = s.flags & 0x1ff;
  if (s.index > 255) flags |= 4;
  w.bits(flags, 9);
  if (flags & 1) w.bits(s.volume ?? 255, 8);
  if (flags & 2) w.bits(s.attenuation ?? 0, 8);
  w.bits(s.channel & 7, 3);
  w.bits(s.entity & 0x7ff, 11);
  w.bits(s.index, flags & 4 ? 16 : 8);
  for (const v of s.origin) w.bool(v !== 0);
  for (const v of s.origin) if (v !== 0) writeCoord(w, v);
  if (flags & 8) w.bits(s.pitch ?? 100, 8);
  w.alignToByte();
  return w.finish();
}

/** svc_newmovevars in protocol 48's layout: the 16 values of 1999, footsteps, roll and sky settings, sky name. */
export function encodeMoveVars48(values: number[], skyName: string): Uint8Array {
  const out = new Uint8Array(1 + 97 + skyName.length + 1);
  const dv = new DataView(out.buffer);
  out[0] = Svc.NewMoveVars;
  values.slice(0, 16).forEach((v, i) => dv.setFloat32(1 + i * 4, v, true));
  out[65] = 1; // footsteps
  // roll angle/speed, sky colour and sky vector stay 0
  for (let i = 0; i < skyName.length; i++) out[98 + i] = skyName.charCodeAt(i) & 0xff;
  return out;
}

function encodeUserInfo48(slot: number, userId: number, text: string): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.UpdateUserInfo);
  w.u8(slot);
  w.bits(userId >>> 0, 32);
  w.string(text);
  w.bytes(new Uint8Array(16)); // CD key hash (none in 1999)
  return w.finish();
}

/** Protocol 48 values of a 1999 entity (entity_state_t field names). */
function entityValues(e: EntState40): Values48 {
  const v: Values48 = {
    'origin[0]': e.origin[0], 'origin[1]': e.origin[1], 'origin[2]': e.origin[2],
    'angles[0]': e.angles[0], 'angles[1]': e.angles[1], 'angles[2]': e.angles[2],
    modelindex: e.modelindex, sequence: e.sequence, frame: e.frame, colormap: e.colormap, skin: e.skin, solid: e.solid,
    effects: e.effects, scale: e.scale, rendermode: e.rendermode, renderamt: e.renderamt, renderfx: e.renderfx,
    'rendercolor.r': e.rendercolor[0], 'rendercolor.g': e.rendercolor[1], 'rendercolor.b': e.rendercolor[2],
    movetype: e.movetype, framerate: e.framerate, body: e.body, aiment: e.aiment,
    'blending[0]': e.blending[0], 'blending[1]': e.blending[1],
  };
  e.controller.forEach((c, i) => { v[`controller[${i}]`] = c; });
  return v;
}

/** Protocol 48 values of a 1999 player (entity_state_player_t field names). */
function playerValues(p: PlayerState40, playerModel: number): Values48 {
  const a = p.viewangles ?? [0, 0, 0];
  const pitch = a[0] > 180 ? a[0] - 360 : a[0];
  const v: Values48 = {
    'origin[0]': p.origin[0], 'origin[1]': p.origin[1], 'origin[2]': p.origin[2],
    // The 1999 client turned the player model by a third of the view pitch, the other way (engine constant -1/3).
    'angles[0]': -pitch / 3, 'angles[1]': a[1], 'angles[2]': a[2],
    modelindex: p.modelindex ?? playerModel, sequence: p.sequence ?? 0, gaitsequence: p.gaitsequence, frame: p.frame,
    weaponmodel: p.weaponmodel, effects: p.effects, skin: p.skin, movetype: p.movetype, framerate: 1,
    rendermode: p.rendermode, renderamt: p.renderamt, renderfx: p.renderfx,
    'rendercolor.r': p.rendercolor[0], 'rendercolor.g': p.rendercolor[1], 'rendercolor.b': p.rendercolor[2],
    scale: p.scale === 1 ? 0 : p.scale, body: p.body, 'blending[0]': p.blending[0], 'blending[1]': p.blending[1], solid: 3,
  };
  p.controller.forEach((c, i) => { v[`controller[${i}]`] = c; });
  return v;
}

interface Tick {
  time: number;
  origin: [number, number, number];
  angles: [number, number, number];
  velocity: [number, number, number];
  viewheight: number;
  health: number;
  onground: boolean;
  waterlevel: number;
  msec: number;
  buttons: number;
  items: number;
  fov: number;
}

class Converter {
  readonly applied: Record<string, number> = {};
  readonly warnings: string[] = [];
  private readonly s;
  private readonly d48 = descriptors48();
  private maxClients = 32;
  private slot = 0;
  private playerModel = 0;
  private readonly baselines40 = new Map<number, EntState40>();
  private readonly baselines48 = new Map<number, Values48>();
  private lastEntities = new Map<number, EntState40>();
  private readonly lastAnimtime = new Map<number, number>();
  private readonly resources: Resource40[] = [];
  private readonly userIds = new Map<number, number>();
  private moveVars?: { values: number[]; skyName: string };
  private maxSpeed = 250;
  fov = 90;
  /** Latest state of the recorder (for the frame info block). */
  tick: Tick = { time: 0, origin: [0, 0, 0], angles: [0, 0, 0], velocity: [0, 0, 0], viewheight: 17, health: 100, onground: false, waterlevel: 0, msec: 0, buttons: 0, items: 0, fov: 90 };

  constructor(private readonly protocol: number, private readonly opts: Convert1999Options) {
    this.s = createState40(protocol);
  }

  count(rule: string, n = 1): void {
    this.applied[rule] = (this.applied[rule] ?? 0) + n;
  }

  private userId(old: number): number {
    if (old >= 64) return old;
    let id = this.userIds.get(old);
    if (id === undefined) {
      id = 200 + this.userIds.size; // 54-63 are engine messages in protocol 48
      this.userIds.set(old, id);
      this.count('user message renumbered');
    }
    return id;
  }

  private resourceList(): Uint8Array {
    const missing = this.opts.isResourceMissing;
    const out: Resource[] = [];
    let dropped = 0;
    for (const r of this.resources) {
      let name = r.name;
      if (r.type === 2 && /^models\/v_.*_r\.mdl$/i.test(name)) {
        // CS betas shipped right-handed view models as v_*_r.mdl; today's v_*.mdl are right-handed.
        name = name.replace(/_r\.mdl$/i, '.mdl');
        this.count('beta: right-handed view model');
      }
      if (r.type === 2 && this.opts.mapName && name.toLowerCase() === `maps/${this.mapFileName()}`) name = `maps/${this.opts.mapName}.bsp`;
      if (missing && missing(name)) { dropped++; continue; }
      out.push({ type: r.type, name, index: r.index, size: Math.max(0, Math.min(r.size, 0xffffff)), flags: (r.md5 ? 4 : 0) | (r.flags & 3), md5: r.md5 });
    }
    if (dropped) this.warnings.push(`Removed ${dropped} resources that don't exist in the current game.`);
    this.count('resource list');
    return encodeResourceList({ kind: 'resourceList', resources: out, hadConsistencyList: false });
  }

  private mapFile = '';
  private mapFileName(): string {
    return this.mapFile.toLowerCase().replace(/^maps\//, '');
  }

  private descriptorFor(n: number): string {
    return n >= 1 && n <= this.maxClients ? 'entity_state_player_t' : 'entity_state_t';
  }

  private baseline48(number: number, e: EntState40): Uint8Array {
    const name = this.descriptorFor(number);
    const values = entityValues(e);
    this.baselines48.set(number, values);
    const w = new BitWriter();
    w.u8(Svc.SpawnBaseline);
    w.bits(number, 11);
    w.bits(1, 2);
    this.d48.get(name)!.encode(w, deltaRecord(this.d48.get(name)!, values));
    w.bits(0x7ff, 11);
    w.bits(0x1f, 5);
    w.bits(0, 6);
    w.alignToByte();
    return w.finish();
  }

  /** svc_clientdata + svc_packetentities for one frame. */
  private snapshot(cd: ClientData40 | undefined, players: PlayerState40[], entities: Map<number, EntState40> | undefined, time: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    const me = players.find((p) => p.slot === this.slot);
    if (me) this.tick.origin = [...me.origin];
    if (me?.msec !== undefined) this.tick.msec = me.msec;
    if (me) this.tick.buttons = me.buttons;
    if (cd) {
      this.tick.velocity = [...cd.velocity];
      this.tick.viewheight = cd.viewheight;
      this.tick.health = cd.health;
      this.tick.onground = cd.onground;
      this.tick.waterlevel = cd.waterlevel;
      if (cd.items !== undefined) this.tick.items = cd.items >>> 0;
      const c: Values48 = {
        'origin[0]': this.tick.origin[0], 'origin[1]': this.tick.origin[1], 'origin[2]': this.tick.origin[2],
        'velocity[0]': cd.velocity[0], 'velocity[1]': cd.velocity[1], 'velocity[2]': cd.velocity[2],
        'view_ofs[2]': cd.viewheight, 'punchangle[0]': cd.punchangle[0], 'punchangle[1]': cd.punchangle[1], 'punchangle[2]': cd.punchangle[2],
        health: cd.health, waterlevel: cd.waterlevel, weapons: this.tick.items, viewmodel: cd.weaponframe, maxspeed: this.maxSpeed, fov: this.fov,
        flags: FL_CLIENT | (cd.onground ? FL_ONGROUND : 0) | (cd.viewheight > 0 && cd.viewheight < 17 ? FL_DUCKING : 0),
        bInDuck: 0, deadflag: cd.health <= 0 ? 2 : 0,
      };
      const w = new BitWriter();
      w.u8(Svc.ClientData);
      w.bool(false); // full update (no delta frame)
      this.d48.get('clientdata_t')!.encode(w, deltaRecord(this.d48.get('clientdata_t')!, c));
      w.bool(false); // no weapon data
      w.alignToByte();
      out.push(w.finish());
      this.count('client data (protocol 48)');
    }
    if (!entities && !players.length) return out;
    const list = new Map<number, Values48>();
    for (const p of players) {
      const n = p.slot + 1;
      const v = playerValues(p, this.playerModel);
      if (p.animtime !== undefined && this.lastAnimtime.get(n) !== p.animtime) {
        this.lastAnimtime.set(n, p.animtime);
        v.animtime = 0;
      }
      list.set(n, v);
    }
    for (const [n, e] of entities ?? this.lastEntities) {
      if (n <= this.maxClients) continue;
      const v = entityValues(e);
      if (this.lastAnimtime.get(n) !== e.animtime) {
        this.lastAnimtime.set(n, e.animtime);
        if (e.animtime) v.animtime = 0;
      }
      list.set(n, v);
    }
    const numbers = [...list.keys()].sort((a, b) => a - b);
    const ents: PacketEntity[] = [];
    let prev = 0;
    for (const n of numbers) {
      const name = this.descriptorFor(n);
      const v = list.get(n)!;
      const base = this.baselines48.get(n) ?? {};
      const d = this.d48.get(name)!;
      const record = deltaRecord(d, v, base);
      if ('animtime' in v) {
        // Restarted animation: send the time field (0 = "now") even when it equals the baseline's.
        const i = d.fields.findIndex((f) => f.name === 'animtime');
        const mask = new Uint8Array(Math.max(record.mask.length, (i >> 3) + 1));
        mask.set(record.mask);
        mask[i >> 3] |= 1 << (i & 7);
        const values = record.values.slice();
        values[i] = { negative: false, magnitude: 0 };
        ents.push({ number: n, numbering: n - prev === 1 ? { mode: 'next' } : n - prev < 64 ? { mode: 'relative', value: n - prev } : { mode: 'absolute', value: n }, remove: false, custom: false, descriptor: name, record: { mask, values } });
      } else {
        ents.push({ number: n, numbering: n - prev === 1 ? { mode: 'next' } : n - prev < 64 ? { mode: 'relative', value: n - prev } : { mode: 'absolute', value: n }, remove: false, custom: false, descriptor: name, record });
      }
      prev = n;
    }
    out.push(encodeEntities({ kind: 'entities', isDelta: false, count: ents.length, entities: ents }, this.d48));
    this.count('entities (protocol 48)');
    void time;
    return out;
  }

  /** Converts one frame's messages. */
  frame(f: NetFrame4): Uint8Array[] {
    const msgs: Message40[] = decodeMessages40(f.messages, this.s);
    const out: Uint8Array[] = [];
    let cd: ClientData40 | undefined;
    const players: PlayerState40[] = [];
    let entities: Map<number, EntState40> | undefined;
    let at = -1; // where the snapshot goes
    for (const m of msgs) {
      const b = m.body;
      const same = SAME_LAYOUT[m.id];
      if (b?.kind === 'serverInfo') {
        this.maxClients = b.maxClients;
        this.slot = b.slot & 0x7f;
        this.mapFile = b.mapFile;
        const mapName = this.opts.mapName ? `maps/${this.opts.mapName}.bsp` : b.mapFile;
        const hash = new Uint8Array(16);
        new DataView(hash.buffer).setUint32(0, b.clientChecksum >>> 0, true);
        out.push(encodeServerInfo({
          kind: 'serverInfo', protocol: 48, spawnCount: b.spawnCount, mungedMapChecksum: b.mapChecksum, clientDllHash: hash,
          maxClients: b.maxClients, playerSlot: b.slot, deathmatch: b.deathmatch, gameDir: b.gameDir, hostName: '', mapName, mapCycle: '', extra: Uint8Array.of(0),
        }, { protocol: 48, extra: Uint8Array.of(0) }));
        out.push(...encodeDeltaDescriptions48());
        this.count('server info: protocol 48');
        this.count('delta descriptions (protocol 48)');
        if (this.opts.mapName) this.count('map renamed');
        continue;
      }
      switch (b?.kind) {
        case 'clientData': cd = b; if (at < 0) at = out.length; continue;
        case 'playerInfo': players.push(b.player); if (at < 0) at = out.length; continue;
        case 'entities': {
          const next = new Map<number, EntState40>();
          const from = b.delta ? this.lastEntities : undefined;
          if (b.delta) this.count('1999 delta entities (approximate)');
          if (from) for (const [n, e] of from) next.set(n, e);
          for (const u of b.updates) {
            if (u.remove) { next.delete(u.number); continue; }
            const e = cloneEnt40(from?.get(u.number) ?? this.baselines40.get(u.number) ?? emptyEnt40());
            u.apply(e);
            next.set(u.number, e);
          }
          entities = next;
          this.lastEntities = next;
          if (at < 0) at = out.length;
          continue;
        }
        case 'baseline':
          this.baselines40.set(b.number, b.state);
          out.push(this.baseline48(b.number, b.state));
          this.count('baseline (protocol 48)');
          continue;
        case 'static':
          this.count('static entity left out');
          continue;
        case 'sound':
          out.push(encodeSound48(b));
          this.count('sound (protocol 48)');
          continue;
        case 'resourceList':
          for (const r of b.resources) this.resources.push(r);
          if (b.end >= b.total) {
            this.playerModel = this.resources.find((r) => r.type === 2 && r.name.toLowerCase() === 'models/player.mdl')?.index ?? 0;
            out.push(this.resourceList());
          }
          continue;
        case 'newUserMsg':
          out.push(encodeNewUserMsg({ id: this.userId(b.id), size: b.size, name: b.name }, b.nameField));
          continue;
        case 'user':
          if (b.name === 'SetFOV' && b.payload.length) this.fov = b.payload[0] || 90;
          out.push(encodeUserMessage(this.userId(m.id), b.payload, b.sized));
          continue;
        case 'userInfo': {
          let text = b.text;
          const swapped = text.replace(/(\\model\\)arab(?=\\|$)/i, '$1leet');
          if (swapped !== text) { text = swapped; this.count('beta: arab model -> leet'); }
          out.push(encodeUserInfo48(b.slot, b.userId, text));
          this.count('user info: add hash');
          continue;
        }
        case 'moveVars':
          this.moveVars = { values: b.values, skyName: b.skyName };
          out.push(encodeMoveVars48(b.values, b.skyName));
          this.count('movevars (protocol 48)');
          continue;
        case 'maxSpeed':
          if (b.slot === this.slot) this.maxSpeed = b.speed;
          this.count('client max speed -> client data');
          continue;
      }
      if (same !== undefined) {
        const bytes = new Uint8Array(1 + m.payload.length);
        bytes[0] = same;
        bytes.set(m.payload, 1);
        out.push(bytes);
        if (same !== m.id) this.count('message renumbered');
        continue;
      }
      this.count(`dropped: ${m.name}`);
    }
    if (at >= 0) out.splice(at, 0, ...this.snapshot(cd, players, entities, f.time));
    return out;
  }

  /** The 464-byte frame info block (view info + sequence info) for a playback frame. */
  info(view: { angles: [number, number, number] } | undefined, seq: Uint8Array | undefined, time: number): Uint8Array {
    const t = this.tick;
    const out = new Uint8Array(464);
    const dv = new DataView(out.buffer);
    const f3 = (at: number, v: readonly number[]) => v.forEach((x, i) => dv.setFloat32(at + i * 4, x, true));
    const angles = view?.angles ?? t.angles;
    t.angles = angles;
    // ref_params (after a 4-byte timestamp): vieworg 4, viewangles 16, frametime 64, time 68, onground 84,
    // waterlevel 88, simvel 92, simorg 104, viewheight 116, cl_viewangles 132, health 144, maxclients 176,
    // viewentity 180, playernum 184, max_entities 188. Then usercmd at 236 (msec 238, viewangles 240, buttons 266),
    // movevars at 288 (132 bytes), and the 28-byte sequence info at 436.
    f3(4, t.origin);
    f3(16, angles);
    dv.setFloat32(64, t.msec / 1000, true);
    dv.setFloat32(68, time, true);
    dv.setInt32(84, t.onground ? 1 : 0, true);
    dv.setInt32(88, t.waterlevel, true);
    f3(92, t.velocity);
    f3(104, t.origin);
    f3(116, [0, 0, t.viewheight]);
    f3(132, angles);
    dv.setInt32(144, t.health, true);
    dv.setInt32(176, this.maxClients, true);
    dv.setInt32(180, this.slot + 1, true);
    dv.setInt32(184, this.slot, true);
    dv.setInt32(188, 900, true);
    out[238] = t.msec & 0xff;
    f3(240, angles);
    dv.setUint16(266, t.buttons & 0xffff, true);
    if (this.moveVars) {
      this.moveVars.values.slice(0, 16).forEach((v, i) => dv.setFloat32(288 + i * 4, v, true));
      dv.setInt32(352, 1, true);
      for (let i = 0; i < Math.min(31, this.moveVars.skyName.length); i++) out[356 + i] = this.moveVars.skyName.charCodeAt(i) & 0xff;
    }
    if (seq) out.set(seq.subarray(0, 28), 436);
    return out;
  }

  /** The 32-byte client-data frame (origin, view angles, weapon bits, field of view). */
  clientFrame(): Uint8Array {
    const out = new Uint8Array(32);
    const dv = new DataView(out.buffer);
    this.tick.origin.forEach((v, i) => dv.setFloat32(i * 4, v, true));
    this.tick.angles.forEach((v, i) => dv.setFloat32(12 + i * 4, v, true));
    dv.setUint32(24, this.tick.items >>> 0, true);
    dv.setFloat32(28, this.fov, true);
    return out;
  }
}

/** View angles stored in a format-4 net frame's info (angle i, origin i, interleaved). */
function infoAngles(info: Uint8Array): [number, number, number] {
  const dv = new DataView(info.buffer, info.byteOffset, info.length);
  return [dv.getFloat32(0, true), dv.getFloat32(8, true), dv.getFloat32(16, true)];
}

function header48(d: Demo4, mapName: string): DemoHeader {
  const raw = new Uint8Array(544);
  const dv = new DataView(raw.buffer);
  raw.set(new TextEncoder().encode('HLDEMO'), 0);
  dv.setUint32(8, 5, true);
  dv.setUint32(12, 48, true);
  raw.set(new TextEncoder().encode(mapName).subarray(0, 259), 16);
  raw.set(new TextEncoder().encode(d.header.gameDir).subarray(0, 259), 276);
  dv.setUint32(536, d.header.mapChecksum >>> 0, true);
  return { magic: 'HLDEMO', demoProtocol: 5, networkProtocol: 48, mapName, gameDir: d.header.gameDir, mapChecksum: d.header.mapChecksum, directoryOffset: 0, raw };
}

export function isConvertible1999(protocol: number): boolean {
  return protocol === 39 || protocol === 40;
}

export function convert1999(input: Uint8Array | Demo4, options: Convert1999Options = {}): { demo: DemoFile; report: UpgradeReport } {
  const d = input instanceof Uint8Array ? readDemo4(input) : input;
  const P = d.header.networkProtocol;
  if (!isConvertible1999(P)) throw new Error(`Network protocol ${P} (1999) is not supported yet (supported: 39-40).`);
  const c = new Converter(P, options);
  const sections: Section[] = [];
  for (const sec of d.sections) {
    const frames: Frame[] = [];
    let seq: Uint8Array | undefined;
    for (const f of sec.frames) {
      switch (f.type) {
        case Frame4Type.View: break;
        case Frame4Type.SequenceInfo: seq = f.data; break;
        case Frame4Type.PacketEnd: break;
        case Frame4Type.PlaybackStart: frames.push({ type: FrameType.DemoStart, time: f.time, index: f.index, payload: new Uint8Array(0) }); break;
        case Frame4Type.SectionEnd: frames.push({ type: FrameType.SectionEnd, time: f.time, index: f.index, payload: new Uint8Array(0) }); break;
        case Frame4Type.ConsoleCommand: {
          const end = f.data.indexOf(0);
          frames.push({ type: FrameType.ConsoleCommand, time: f.time, index: f.index, command: String.fromCharCode(...(end < 0 ? f.data : f.data.subarray(0, end))), raw: f.data });
          break;
        }
        case Frame4Type.Net:
        case Frame4Type.NetLoading: {
          let parts: Uint8Array[];
          try {
            parts = c.frame(f);
          } catch (e) {
            c.warnings.push(`Frame ${f.index} at ${f.time.toFixed(2)}s could not be read and was left out: ${(e as Error).message}`);
            break;
          }
          const total = parts.reduce((n, p) => n + p.length, 0);
          const messages = new Uint8Array(total);
          let o = 0;
          for (const p of parts) { messages.set(p, o); o += p.length; }
          if (f.type === Frame4Type.Net) {
            const info = c.info({ angles: infoAngles(f.info) }, seq, f.time);
            frames.push({ type: FrameType.ClientData, time: f.time, index: f.index, payload: c.clientFrame() });
            frames.push({ type: FrameType.NetMessages, time: f.time, index: f.index, info, messages });
          } else {
            frames.push({ type: FrameType.NetMessagesLoading, time: f.time, index: f.index, info: new Uint8Array(464), messages });
          }
          seq = undefined;
          break;
        }
      }
    }
    sections.push({ entry: null, frames });
  }
  if (d.problems.length) c.warnings.push(...d.problems);
  const mapName = options.mapName ?? d.header.mapName;
  return {
    demo: { header: header48(d, mapName), sections, problems: [], recovered: false },
    report: { sourceProtocol: P, applied: c.applied, warnings: c.warnings },
  };
}
