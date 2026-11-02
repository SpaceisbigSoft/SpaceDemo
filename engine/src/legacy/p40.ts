// Network protocol 39-40 (Half-Life 1.0.1.3 / 1.0.1.6, 1999 CS betas): message decoder. Plan F4.
// Facts from the decompiled HL 1.0.1.6 client (Work\Old CS Lab\analysis\hl1016\decompiled; README there) and checked on
// Old CS Lab recordings with tools/dev/p40-decode.py. Layouts: docs/FORMAT.md ("Protocol 38-40").
// Unlike later protocols there are no delta descriptions: every bit-packed layout is fixed in the engine, players come
// in svc_playerinfo (not as entities), and bits are packed most-significant-first.
import { FormatError } from '../binary/errors.js';
import { latin1 } from '../binary/byte-reader.js';

/** Message ids of protocol 38-40 (the engine's svc_ name table). Ids above 53 are game (user) messages. */
export const P40 = {
  Bad: 0, Nop: 1, Disconnect: 2, UpdateStat: 3, Version: 4, SetView: 5, Sound: 6, Time: 7, Print: 8, StuffText: 9,
  SetAngle: 10, ServerInfo: 11, LightStyle: 12, UpdateUserInfo: 13, UpdateFrags: 14, ClientData: 15, StopSound: 16,
  UpdateColors: 17, Particle: 18, Damage: 19, SpawnStatic: 20, SpawnBinary: 21, SpawnBaseline: 22, TempEntity: 23,
  SetPause: 24, SignOnNum: 25, CenterPrint: 26, KilledMonster: 27, FoundSecret: 28, SpawnStaticSound: 29,
  Intermission: 30, Finale: 31, CdTrack: 32, Restore: 33, Cutscene: 34, WeaponAnim: 35, DecalName: 36, RoomType: 37,
  AddAngle: 38, NewUserMsg: 39, Download: 40, PacketEntities: 41, DeltaPacketEntities: 42, PlayerInfo: 43, Choke: 44,
  ResourceList: 45, NewMoveVars: 46, NextUpload: 47, ResourceRequest: 48, Customization: 49, CrosshairAngle: 50,
  SoundFade: 51, ClientMaxSpeed: 52, SkippedUpdate: 53,
} as const;
export const P40_FIRST_USER_MESSAGE = 54;

/** Reader for protocol 38-40 messages: bytes little-endian; bit fields MSB-first, started at a byte (MSG_StartBits). */
export class LegacyReader {
  p: number;
  private bp = 0;
  private bi = 8;
  /** Reads 32 bits without consuming them. */
  peek32(): number {
    const p = this.p, bp = this.bp, bi = this.bi;
    const v = this.bits(32);
    this.p = p;
    this.bp = bp;
    this.bi = bi;
    return v;
  }
  constructor(readonly d: Uint8Array, start = 0) {
    this.p = start;
  }
  get atEnd(): boolean {
    return this.p >= this.d.length;
  }
  private need(n: number): void {
    if (this.p + n > this.d.length) throw new FormatError(`Ran out of data at byte ${this.p}`);
  }
  u8(): number {
    this.need(1);
    return this.d[this.p++];
  }
  i8(): number {
    const v = this.u8();
    return v >= 128 ? v - 256 : v;
  }
  u16(): number {
    this.need(2);
    const v = this.d[this.p] | (this.d[this.p + 1] << 8);
    this.p += 2;
    return v;
  }
  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  i32(): number {
    this.need(4);
    const v = this.d[this.p] | (this.d[this.p + 1] << 8) | (this.d[this.p + 2] << 16) | (this.d[this.p + 3] << 24);
    this.p += 4;
    return v;
  }
  u32(): number {
    return this.i32() >>> 0;
  }
  f32(): number {
    this.need(4);
    const v = new DataView(this.d.buffer, this.d.byteOffset + this.p, 4).getFloat32(0, true);
    this.p += 4;
    return v;
  }
  coord(): number {
    return this.i16() / 8;
  }
  string(): string {
    const end = this.d.indexOf(0, this.p);
    if (end < 0) throw new FormatError(`Unterminated string at byte ${this.p}`);
    const s = latin1(this.d.subarray(this.p, end));
    this.p = end + 1;
    return s;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.d.slice(this.p, this.p + n);
    this.p += n;
    return out;
  }
  skip(n: number): void {
    this.need(n);
    this.p += n;
  }
  /** MSG_StartBits: bit reading begins at the current byte, which counts as read. */
  startBits(): void {
    this.need(1);
    this.bp = this.p;
    this.bi = 0;
    this.p += 1;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.bi === 8) {
        this.bi = 0;
        this.bp += 1;
        this.p += 1;
      }
      if (this.bp >= this.d.length) throw new FormatError('Bit field runs past the end of the message data');
      v = v * 2 + ((this.d[this.bp] >> (7 - this.bi)) & 1);
      this.bi++;
    }
    return v;
  }
  /** Sign bit, then (n-1) magnitude bits. */
  sbits(n: number): number {
    const negative = this.bits(1) === 1;
    const v = this.bits(n - 1);
    return negative ? -v : v;
  }
  /** Bit angle: n bits as a fraction of 360 degrees. */
  bitAngle(n: number): number {
    return (this.bits(n) * 360) / 2 ** n;
  }
}

/** Full entity state of protocol 38-40 (the client's entity_state; offsets in docs/FORMAT.md). */
export interface EntState40 {
  origin: [number, number, number];
  angles: [number, number, number];
  modelindex: number;
  sequence: number;
  frame: number;
  colormap: number;
  skin: number;
  solid: number;
  effects: number;
  scale: number;
  rendermode: number;
  renderamt: number;
  rendercolor: [number, number, number];
  renderfx: number;
  movetype: number;
  /** Changes whenever the server restarted the animation (only compared, never written as a time). */
  animtime: number;
  framerate: number;
  body: number;
  controller: [number, number, number, number];
  blending: [number, number];
  mins: [number, number, number];
  maxs: [number, number, number];
  aiment: number;
}

export function emptyEnt40(): EntState40 {
  return {
    origin: [0, 0, 0], angles: [0, 0, 0], modelindex: 0, sequence: 0, frame: 0, colormap: 0, skin: 0, solid: 0, effects: 0,
    scale: 0, rendermode: 0, renderamt: 0, rendercolor: [0, 0, 0], renderfx: 0, movetype: 0, animtime: 0, framerate: 0, body: 0,
    controller: [0, 0, 0, 0], blending: [0, 0], mins: [0, 0, 0], maxs: [0, 0, 0], aiment: 0,
  };
}
export function cloneEnt40(e: EntState40): EntState40 {
  return {
    ...e, origin: [...e.origin], angles: [...e.angles], rendercolor: [...e.rendercolor], controller: [...e.controller],
    blending: [...e.blending], mins: [...e.mins], maxs: [...e.maxs],
  };
}

/** One player's state from svc_playerinfo (absent fields have the engine's defaults). */
export interface PlayerState40 {
  /** Player slot (entity number - 1). */
  slot: number;
  flags: number;
  /** 5 state bits (on ground, ducking...). */
  state: number;
  origin: [number, number, number];
  frame: number;
  /** View angles from the player's user command (pitch, yaw, roll in degrees), when sent. */
  viewangles?: [number, number, number];
  buttons: number;
  msec?: number;
  velocity: [number, number, number];
  /** undefined = the engine's default player model. */
  modelindex?: number;
  skin: number;
  effects: number;
  weaponmodel: number;
  movetype: number;
  sequence?: number;
  /** Raw animation time byte (only compared). */
  animtime?: number;
  rendermode: number;
  renderamt: number;
  rendercolor: [number, number, number];
  renderfx: number;
  scale: number;
  body: number;
  controller: [number, number, number, number];
  blending: [number, number];
  gaitsequence: number;
  ping?: number;
  loss?: number;
}

export interface ClientData40 {
  bits: number;
  viewheight: number;
  idealpitch: number;
  punchangle: [number, number, number];
  velocity: [number, number, number];
  items?: number;
  onground: boolean;
  waterlevel: number;
  weaponframe: number;
  health: number;
}

export interface EntityUpdate40 {
  number: number;
  remove: boolean;
  flags: number;
  more: number;
  /** Fields sent (applied over the entity's baseline or previous state by `applyDelta40`). */
  apply: (e: EntState40) => void;
}

export interface Resource40 {
  type: number;
  name: string;
  index: number;
  size: number;
  flags: number;
  md5?: Uint8Array;
}

export type Body40 =
  | { kind: 'serverInfo'; protocol: number; spawnCount: number; mapChecksum: number; clientChecksum: number; maxClients: number; slot: number; deathmatch: number; gameDir: string; mapFile: string; levelName: string }
  | ({ kind: 'clientData' } & ClientData40)
  | { kind: 'playerInfo'; player: PlayerState40 }
  | { kind: 'entities'; delta: boolean; from?: number; count: number; updates: EntityUpdate40[] }
  | { kind: 'baseline'; number: number; state: EntState40 }
  | { kind: 'static'; state: EntState40 }
  | { kind: 'sound'; flags: number; volume?: number; attenuation?: number; channel: number; entity: number; index: number; origin: [number, number, number]; pitch?: number }
  | { kind: 'resourceList'; total: number; first: number; end: number; resources: Resource40[] }
  | { kind: 'newUserMsg'; id: number; size: number; name: string; nameField: Uint8Array }
  | { kind: 'userInfo'; slot: number; userId: number; text: string }
  | { kind: 'moveVars'; values: number[]; skyName: string }
  | { kind: 'maxSpeed'; slot: number; speed: number }
  | { kind: 'time'; time: number }
  | { kind: 'user'; name: string; payload: Uint8Array; sized: boolean };

export interface Message40 {
  id: number;
  name: string;
  start: number;
  end: number;
  /** The message's bytes after the id (for messages copied unchanged). */
  payload: Uint8Array;
  body?: Body40;
}

export interface State40 {
  protocol: number;
  maxClients: number;
  userMessages: Map<number, { name: string; size: number }>;
}

export function createState40(protocol: number): State40 {
  return { protocol, maxClients: 32, userMessages: new Map() };
}

const NAMES = Object.fromEntries(Object.entries(P40).map(([k, v]) => [v, k])) as Record<number, string>;

/** Fixed payload sizes of temporary entities (as in later protocols, checked on 1999 recordings so far). */
const TEMP_ENTITY_SIZE: Record<number, number> = {
  0: 24, 1: 20, 2: 6, 3: 11, 4: 6, 5: 10, 6: 12, 7: 17, 8: 16, 9: 6, 10: 6, 11: 6, 12: 8, 14: 9, 15: 19, 16: 0,
  17: 10, 18: 16, 19: 24, 20: 24, 21: 24, 22: 10, 23: 11, 24: 16, 25: 19, 26: 0, 27: 12, 28: 16, 30: 17, 31: 17,
  99: 2, 100: 10, 101: 14, 102: 12, 103: 14, 104: 9, 105: 5, 106: 17, 107: 13, 108: 24, 109: 9, 110: 17, 111: 7,
  112: 10, 113: 19, 114: 19, 115: 12, 116: 7, 117: 7, 118: 9, 119: 16, 120: 18, 121: 5, 122: 10, 123: 9, 124: 7,
  125: 1, 126: 18, 127: 15,
};

/** Payload sizes of fixed-size messages. */
const FIXED: Partial<Record<number, number>> = {
  [P40.Nop]: 0, [P40.UpdateStat]: 5, [P40.Version]: 4, [P40.SetView]: 2, [P40.SetAngle]: 6, [P40.UpdateFrags]: 3,
  [P40.StopSound]: 2, [P40.UpdateColors]: 2, [P40.Particle]: 11, [P40.Damage]: 8, [P40.SetPause]: 1, [P40.SignOnNum]: 1,
  [P40.KilledMonster]: 0, [P40.FoundSecret]: 0, [P40.SpawnStaticSound]: 14, [P40.Intermission]: 0, [P40.CdTrack]: 2,
  [P40.WeaponAnim]: 2, [P40.RoomType]: 2, [P40.AddAngle]: 2, [P40.Choke]: 0, [P40.ResourceRequest]: 8,
  [P40.CrosshairAngle]: 2, [P40.SoundFade]: 4, [P40.SkippedUpdate]: 1,
};

function readClientData(r: LegacyReader): ClientData40 {
  // Quake-style, byte-aligned (client 10071ae0). Absent fields are zero (view height 22).
  const bits = r.u16();
  const viewheight = bits & 1 ? r.i8() : 22;
  const idealpitch = bits & 2 ? r.i8() : 0;
  const punchangle: [number, number, number] = [0, 0, 0];
  const velocity: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (bits & (4 << i)) punchangle[i] = (r.i16() * 360) / 65536;
    if (bits & (0x20 << i)) velocity[i] = r.i8() * 16;
  }
  const items = bits & 0x100 ? r.u32() : undefined;
  const waterlevel = bits & 0x800 ? (bits & 0x8000 ? 3 : 2) : 0;
  const weaponframe = bits & 0x200 ? r.i16() : 0;
  const health = r.i16();
  return { bits, viewheight, idealpitch, punchangle, velocity, items, onground: (bits & 0x400) !== 0, waterlevel, weaponframe, health };
}

function readDeltaUsercmd(r: LegacyReader, p: PlayerState40): void {
  // MSG_ReadDeltaUsercmd (10067360), always from a zeroed command.
  const f = r.bits(8);
  const a: [number, number, number] = [0, 0, 0];
  if (f & 1) a[0] = (r.bits(10) * 360) / 1024;
  if (f & 2) a[1] = (r.bits(10) * 360) / 1024;
  if (f & 4) a[2] = (r.bits(6) * 360) / 64;
  for (const b of [8, 0x10, 0x20]) if (f & b) r.sbits(8);
  p.buttons = f & 0x40 ? r.bits(16) : 0;
  if (f & 0x80) r.bits(8);
  r.bits(6);
  p.msec = r.bits(8);
  p.viewangles = a;
}

function readPlayerInfo(r: LegacyReader): PlayerState40 {
  // svc_playerinfo (client 10032040).
  let f = r.u8();
  if (f & 0x80) f |= r.u8() << 8;
  if (f & 0x8000) f |= r.u8() << 16;
  if (f & 0x800000) f = (f | (r.u8() << 24)) >>> 0;
  r.startBits();
  const slot = r.bits(6) & 0x3f;
  const state = r.bits(5);
  const origin: [number, number, number] = [r.sbits(18) / 32, r.sbits(18) / 32, r.sbits(18) / 32];
  const p: PlayerState40 = {
    slot, flags: f, state, origin, frame: r.bits(8), buttons: 0, velocity: [0, 0, 0], skin: 0, effects: 0, weaponmodel: 0, movetype: 3,
    rendermode: 0, renderamt: 0, rendercolor: [0, 0, 0], renderfx: 0, scale: 1, body: 0, controller: [0, 0, 0, 0], blending: [0, 0], gaitsequence: 0,
  };
  if (f & 0x1) readDeltaUsercmd(r, p);
  if (f & 0x10) p.msec = r.bits(8);
  if (f & 0x20) {
    p.velocity[0] = r.sbits(14) / 8;
    p.velocity[1] = r.sbits(14) / 8;
  }
  if (f & 0x400) p.velocity[2] = r.sbits(14) / 8;
  if (f & 0x100) p.modelindex = r.bits(10);
  else if (f & 0x2) p.modelindex = r.bits(8);
  if (f & 0x1000000) p.skin = r.bits(8);
  if (f & 0x1000) p.effects = r.bits(8);
  if (f & 0x200) p.weaponmodel = r.bits(10);
  else if (f & 0x40) p.weaponmodel = r.bits(8);
  if (f & 0x10000000) p.movetype = r.bits(4);
  if (f & 0x4) {
    p.sequence = r.bits(8);
    p.animtime = r.bits(8);
  }
  if (f & 0x4000000) {
    p.rendermode = r.bits(8);
    p.renderamt = r.bits(8);
    p.rendercolor = [r.bits(8), r.bits(8), r.bits(8)];
    p.renderfx = r.bits(8);
  }
  if (f & 0x2000) p.scale = r.bits(8) / 16;
  if (f & 0x400000) p.body = r.bits(8);
  [0x10000, 0x20000, 0x40000, 0x80000].forEach((b, i) => { if (f & b) p.controller[i] = r.bits(8); });
  [0x100000, 0x200000].forEach((b, i) => { if (f & b) p.blending[i] = r.bits(8); });
  if (f & 0x4000) { r.sbits(16); r.sbits(16); r.sbits(16); }
  if (f & 0x2000000) r.sbits(16);
  if (f & 0x800) {
    p.ping = r.bits(12);
    p.loss = Math.min(100, r.bits(6));
  }
  if (f & 0x8) p.gaitsequence = r.bits(8);
  return p;
}

/** Entity fields of CL_ParseDelta (10030670): applied over the entity's baseline (or its previous state). */
function readDelta(r: LegacyReader, f: number, more: number): (e: EntState40) => void {
  const set: ((e: EntState40) => void)[] = [];
  const put = (fn: (e: EntState40) => void) => set.push(fn);
  if (f & 0x800) { const v = r.bits(1) === 1 ? r.bits(10) : r.bits(8); put((e) => { e.modelindex = v; }); }
  if (f & 0x80) { const v = r.bits(8); put((e) => { e.frame = v; }); }
  if (f & 0x40) { const v = r.bits(4); put((e) => { e.movetype = v; }); }
  if (f & 0x40000) { const v = r.bits(16); put((e) => { e.colormap = v; }); }
  if (f & 0x80000) { const skin = r.bits(8); const solid = r.bits(3); put((e) => { e.skin = skin; e.solid = solid; }); }
  if (f & 0x40000000) { const v = r.bits(16) / 256; put((e) => { e.scale = v; }); }
  if (f & 0x4000) { const v = r.bits(8); put((e) => { e.effects = v; }); }
  if (f & 2) { const v = r.sbits(16) / 8; put((e) => { e.origin[0] = v; }); }
  if (f & 0x200) { const v = r.bitAngle(11); put((e) => { e.angles[0] = v; }); }
  if (f & 4) { const v = r.sbits(16) / 8; put((e) => { e.origin[1] = v; }); }
  if (f & 0x20) { const v = r.bitAngle(13); put((e) => { e.angles[1] = v; }); }
  if (f & 8) { const v = r.sbits(16) / 8; put((e) => { e.origin[2] = v; }); }
  if (f & 0x400) { const v = r.bitAngle(11); put((e) => { e.angles[2] = v; }); }
  if (f & 0x1000) { const seq = r.bits(8); const t = r.bits(8); put((e) => { e.sequence = seq; e.animtime = t + 1; }); }
  if (f & 0x10000) { const v = r.sbits(8) / 16; put((e) => { e.framerate = v; }); }
  [0x1000000, 0x2000000, 0x4000000, 0x8000000].forEach((b, i) => { if (f & b) { const v = r.bits(8); put((e) => { e.controller[i] = v; }); } });
  [0x10000000, 0x20000000].forEach((b, i) => { if (f & b) { const v = r.bits(8); put((e) => { e.blending[i] = v; }); } });
  if (f & 0x400000) { const v = r.bits(8); put((e) => { e.body = v; }); }
  if (f & 0x100000) {
    const mode = r.bits(8), amt = r.bits(8), c: [number, number, number] = [r.bits(8), r.bits(8), r.bits(8)], fx = r.bits(8);
    put((e) => { e.rendermode = mode; e.renderamt = amt; e.rendercolor = c; e.renderfx = fx; });
  }
  for (let i = 0; i < 6; i++) {
    if (more & (1 << i)) {
      const v = r.sbits(16) / 8;
      put((e) => { if (i < 3) e.mins[i] = v; else e.maxs[i - 3] = v; });
    }
  }
  if (more & 0x40) { const v = r.bits(10); put((e) => { e.aiment = v; }); }
  return (e) => { for (const fn of set) fn(e); };
}

function readEntities(r: LegacyReader, delta: boolean): Body40 {
  const count = r.i16();
  const from = delta ? r.u8() : undefined;
  r.startBits();
  const updates: EntityUpdate40[] = [];
  for (;;) {
    if (r.peek32() === 0) {
      r.bits(32);
      break;
    }
    let f = r.bits(8);
    if (f & 1) f |= r.bits(8) << 8;
    if (f & 0x100) f |= r.bits(8) << 16;
    if (f & 0x800000) f = (f | (r.bits(8) << 24)) >>> 0;
    const more = f & 0x80000000 ? r.bits(8) : 0;
    const number = f & 0x8000 ? r.bits(10) : r.bits(8);
    if (f & 0x10) {
      updates.push({ number, remove: true, flags: f, more, apply: () => undefined });
      continue;
    }
    if (f & 0x2000) throw new FormatError('Beam entities (1999 protocol) are not supported yet');
    updates.push({ number, remove: false, flags: f, more, apply: readDelta(r, f, more) });
  }
  return { kind: 'entities', delta, from, count, updates };
}

function readBaselineBody(r: LegacyReader): EntState40 {
  // Client 100719f0 (entity_state offsets: docs/FORMAT.md).
  const e = emptyEnt40();
  const type = r.u8();
  e.modelindex = r.i16();
  e.sequence = r.u8();
  e.frame = r.u8();
  e.scale = type === 0 ? r.u16() / 256 : r.u8() / 16;
  e.colormap = r.u16();
  e.skin = r.i16();
  e.solid = r.u8();
  for (let i = 0; i < 3; i++) {
    e.origin[i] = r.coord();
    e.angles[i] = r.f32();
    e.mins[i] = r.coord();
    e.maxs[i] = r.coord();
  }
  e.rendermode = r.u8();
  e.renderamt = r.u8();
  e.rendercolor = [r.u8(), r.u8(), r.u8()];
  e.renderfx = r.u8();
  return e;
}

function readSound(r: LegacyReader): Body40 {
  r.startBits();
  const flags = r.bits(9);
  const volume = flags & 1 ? r.bits(8) : undefined;
  const attenuation = flags & 2 ? r.bits(8) : undefined;
  const channel = r.bits(3);
  const entity = r.bits(10);
  const index = flags & 4 ? r.bits(16) : r.bits(8);
  const origin: [number, number, number] = [r.sbits(16) / 8, r.sbits(16) / 8, r.sbits(16) / 8];
  const pitch = flags & 8 ? r.bits(8) : undefined;
  return { kind: 'sound', flags, volume, attenuation, channel, entity, index, origin, pitch };
}

function skipTempEntity(r: LegacyReader): void {
  const type = r.u8();
  if (type === 13) {
    r.skip(8);
    if (r.i16() !== 0) r.skip(2);
    return;
  }
  if (type === 29) {
    r.skip(5);
    const effect = r.u8();
    r.skip(14);
    if (effect === 2) r.skip(2);
    r.string();
    return;
  }
  const size = TEMP_ENTITY_SIZE[type];
  if (size === undefined) throw new FormatError(`Unknown temporary entity type ${type}`);
  r.skip(size);
}

function decodeOne(r: LegacyReader, id: number, s: State40): Body40 | undefined {
  const fixed = FIXED[id];
  if (fixed !== undefined) {
    r.skip(fixed);
    return undefined;
  }
  switch (id) {
    case P40.Disconnect: case P40.Print: case P40.StuffText: case P40.CenterPrint: case P40.Finale: case P40.Restore: case P40.Cutscene:
      r.string();
      return undefined;
    case P40.Time: return { kind: 'time', time: r.f32() };
    case P40.ServerInfo: {
      const protocol = r.i32();
      const spawnCount = r.i32();
      const mapChecksum = r.u32();
      const clientChecksum = r.u32();
      const maxClients = r.u8();
      const slot = r.u8();
      const deathmatch = r.u8();
      const gameDir = r.string();
      const mapFile = r.string();
      const levelName = r.string();
      s.maxClients = maxClients;
      return { kind: 'serverInfo', protocol, spawnCount, mapChecksum, clientChecksum, maxClients, slot, deathmatch, gameDir, mapFile, levelName };
    }
    case P40.LightStyle: r.u8(); r.string(); return undefined;
    case P40.UpdateUserInfo: return { kind: 'userInfo', slot: r.u8(), userId: r.i32(), text: r.string() };
    case P40.ClientData: return { kind: 'clientData', ...readClientData(r) };
    case P40.SpawnStatic: return { kind: 'static', state: readBaselineBody(r) };
    case P40.SpawnBaseline: { const number = r.i16(); return { kind: 'baseline', number, state: readBaselineBody(r) }; }
    case P40.TempEntity: skipTempEntity(r); return undefined;
    case P40.DecalName: r.u8(); r.string(); return undefined;
    case P40.Sound: return readSound(r);
    case P40.NewUserMsg: {
      const msgId = r.u8();
      const size = r.u8();
      const nameField = r.bytes(16);
      const end = nameField.indexOf(0);
      const name = latin1(end < 0 ? nameField : nameField.subarray(0, end));
      s.userMessages.set(msgId, { name, size: size === 255 ? -1 : size });
      return { kind: 'newUserMsg', id: msgId, size: size === 255 ? -1 : size, name, nameField };
    }
    case P40.PacketEntities: return readEntities(r, false);
    case P40.DeltaPacketEntities: return readEntities(r, true);
    case P40.PlayerInfo: return { kind: 'playerInfo', player: readPlayerInfo(r) };
    case P40.ResourceList: {
      const total = r.i16();
      const first = r.i16();
      const end = r.i16();
      const resources: Resource40[] = [];
      for (let i = first; i < end; i++) {
        const res: Resource40 = { type: r.u8(), name: r.string(), index: r.i16(), size: r.i32(), flags: r.u8() };
        if (res.flags & 4) res.md5 = r.bytes(16);
        resources.push(res);
      }
      return { kind: 'resourceList', total, first, end, resources };
    }
    case P40.NewMoveVars: {
      if (s.protocol <= 38) r.u8(); // protocol 38: one more leading byte
      const values: number[] = [];
      for (let i = 0; i < 16; i++) values.push(r.f32());
      return { kind: 'moveVars', values, skyName: r.string() };
    }
    case P40.ClientMaxSpeed: return { kind: 'maxSpeed', slot: r.u8(), speed: r.f32() };
  }
  if (id >= P40_FIRST_USER_MESSAGE) {
    const def = s.userMessages.get(id);
    if (!def) throw new FormatError(`Unknown message id ${id}`);
    const sized = def.size === -1;
    const size = sized ? r.u8() : def.size;
    return { kind: 'user', name: def.name, payload: r.bytes(size), sized };
  }
  throw new FormatError(`Message ${NAMES[id] ?? id} is not supported for 1999 demos yet`);
}

export class MessageError40 extends Error {
  constructor(message: string, readonly partial: Message40[]) {
    super(message);
    this.name = 'MessageError40';
  }
}

/** Decodes every message of one frame (data without the netchan header). */
export function decodeMessages40(data: Uint8Array, s: State40): Message40[] {
  const r = new LegacyReader(data);
  const out: Message40[] = [];
  while (!r.atEnd) {
    const start = r.p;
    const id = r.u8();
    const name = NAMES[id] ?? s.userMessages.get(id)?.name ?? `user${id}`;
    try {
      const body = decodeOne(r, id, s);
      out.push({ id, name, start, end: r.p, payload: data.subarray(start + 1, r.p), body });
    } catch (e) {
      throw new MessageError40(`${(e as Error).message} (in ${name} at byte ${start})`, out);
    }
  }
  return out;
}
