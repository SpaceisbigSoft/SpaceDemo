// Decoding of server network messages inside a demo frame. Every message keeps its exact byte
// range so unchanged messages can be written back as-is. Layouts are documented in docs/FORMAT.md.
import { BitReader } from '../binary/bits.js';
import { FormatError } from '../binary/errors.js';
import { DESCRIPTION_DESCRIPTOR, descriptorFromRecords, type DeltaDescriptor, type DeltaRecord } from './delta.js';
import { FIRST_USER_MESSAGE_ID, Svc, svcName } from './ids.js';

export interface UserMessageDef {
  id: number;
  /** Fixed payload size in bytes, or -1 when the first payload byte gives the size. */
  size: number;
  name: string;
}

/** Everything the decoder must remember between frames. */
export interface ProtocolState {
  protocol: number;
  gameDir: string;
  maxClients: number;
  /** True once the demo is known to be an HLTV recording. */
  hltv: boolean;
  /** Weapon index width in svc_clientdata (5 bits before protocol 47, 6 bits after). */
  weaponIndexBits: number;
  /** Protocol 46 demos recorded with an early Steam CS 1.6 client already use protocol-47 layouts. */
  betaSteam: boolean;
  deltas: Map<string, DeltaDescriptor>;
  userMessages: Map<number, UserMessageDef>;
}

export function createState(protocol: number, gameDir: string): ProtocolState {
  return {
    protocol,
    gameDir,
    maxClients: 32,
    hltv: false,
    weaponIndexBits: protocol >= 47 ? 6 : 5,
    betaSteam: false,
    deltas: new Map([[DESCRIPTION_DESCRIPTOR.name, DESCRIPTION_DESCRIPTOR]]),
    userMessages: new Map(),
  };
}

// ---- decoded bodies (only for messages we need to understand or change) ----

export interface ServerInfoBody {
  kind: 'serverInfo';
  protocol: number;
  spawnCount: number;
  mungedMapChecksum: number;
  clientDllHash: Uint8Array;
  maxClients: number;
  playerSlot: number;
  deathmatch: number;
  gameDir: string;
  hostName: string;
  mapName: string;
  mapCycle: string;
  /** Trailing VAC/extra-info block: a flag byte and, if the flag is set, its data. */
  extra: Uint8Array;
}
export interface UserInfoBody {
  kind: 'userInfo';
  slot: number;
  userId: number;
  info: Record<string, string>;
}
export interface NewUserMsgBody {
  kind: 'newUserMsg';
  def: UserMessageDef;
  /** The original 16-byte name field (some servers leave junk after the name). */
  nameField: Uint8Array;
}
export interface VoiceInitBody {
  kind: 'voiceInit';
  codec: string;
  quality?: number;
}
export interface VoiceDataBody {
  kind: 'voiceData';
  slot: number;
  data: Uint8Array;
}
export interface HltvBody {
  kind: 'hltv';
  command: number;
}
export interface DirectorBody {
  kind: 'director';
  data: Uint8Array;
}
/** svc_event: client-side events such as weapon fire (index = event resource, entity = who fired). */
export interface EventsBody {
  kind: 'events';
  events: { index: number; entity?: number; record?: DeltaRecord; fireTime?: number }[];
}
/** svc_sound: a sound played by an entity (footsteps, shots, reloads, bomb beeps), with its position when sent. */
export interface SoundBody {
  kind: 'sound';
  entity: number;
  channel: number;
  sound: number;
  origin: [number | undefined, number | undefined, number | undefined];
}
export interface TextBody {
  kind: 'text';
  text: string;
}
export interface ClientDataBody {
  kind: 'clientData';
  deltaSequence?: number;
  client: DeltaRecord;
  weapons: { index: number; record: DeltaRecord }[];
}
export type EntityNumbering = { mode: 'next' } | { mode: 'absolute'; value: number } | { mode: 'relative'; value: number };
export interface PacketEntity {
  number: number;
  numbering: EntityNumbering;
  remove: boolean;
  custom: boolean;
  /** Baseline index (svc_packetentities only), when the entity is relative to a baseline. */
  baseline?: number;
  descriptor: string;
  record?: DeltaRecord;
}
export interface EntitiesBody {
  kind: 'entities';
  isDelta: boolean;
  count: number;
  deltaSequence?: number;
  entities: PacketEntity[];
}
export interface BaselineBody {
  kind: 'baseline';
  entities: { index: number; type: number; descriptor: string; record: DeltaRecord }[];
  extras: DeltaRecord[];
}
export interface Resource {
  type: number;
  name: string;
  index: number;
  size: number;
  flags: number;
  md5?: Uint8Array;
  extra?: Uint8Array;
}
export interface ResourceListBody {
  kind: 'resourceList';
  resources: Resource[];
  /** Raw consistency-list bits are not kept; whether one was present is. */
  hadConsistencyList: boolean;
}
export interface UserMessageBody {
  kind: 'user';
  name: string;
  payload: Uint8Array;
  /** True when the message carries its own size byte. */
  sized: boolean;
}

export type MessageBody =
  | ServerInfoBody | UserInfoBody | NewUserMsgBody | VoiceInitBody | VoiceDataBody | HltvBody | DirectorBody
  | TextBody | EventsBody | SoundBody | ClientDataBody | EntitiesBody | BaselineBody | ResourceListBody | UserMessageBody;

export interface Message {
  id: number;
  name: string;
  /** Byte range in the frame's message data, including the id byte. Absent for messages created by a transform. */
  start?: number;
  end?: number;
  body?: MessageBody;
  /** Replacement encoding (including the id byte), set by transforms. */
  bytes?: Uint8Array;
}

export class MessageError extends Error {
  constructor(message: string, readonly byteOffset: number, readonly partial: Message[]) {
    super(message);
    this.name = 'MessageError';
  }
}

// ---- helpers ----

function descriptor(s: ProtocolState, name: string): DeltaDescriptor {
  const d = s.deltas.get(name);
  if (!d) throw new FormatError(`Delta description "${name}" has not been received`);
  return d;
}

function entityDescriptor(s: ProtocolState, number: number, custom: boolean): string {
  if (number > 0 && number <= s.maxClients) return 'entity_state_player_t';
  return custom ? 'custom_entity_state_t' : 'entity_state_t';
}

/** Fixed payload sizes of temporary entities (TE_*), by type. */
const TEMP_ENTITY_SIZE: Record<number, number> = {
  0: 24, 1: 20, 2: 6, 3: 11, 4: 6, 5: 10, 6: 12, 7: 17, 8: 16, 9: 6, 10: 6, 11: 6, 12: 8, 14: 9, 15: 19, 16: 0,
  17: 10, 18: 16, 19: 24, 20: 24, 21: 24, 22: 10, 23: 11, 24: 16, 25: 19, 26: 0, 27: 12, 28: 16, 30: 17, 31: 17,
  99: 2, 100: 10, 101: 14, 102: 12, 103: 14, 104: 9, 105: 5, 106: 17, 107: 13, 108: 24, 109: 9, 110: 17, 111: 7,
  112: 10, 113: 19, 114: 19, 115: 12, 116: 7, 117: 7, 118: 9, 119: 16, 120: 18, 121: 5, 122: 10, 123: 9, 124: 7,
  125: 1, 126: 18, 127: 15,
};

/** Fixed sizes of simple messages (payload bytes after the id). */
const FIXED_SIZE: Partial<Record<number, number>> = {
  [Svc.Nop]: 0, [Svc.Version]: 4, [Svc.SetView]: 2, [Svc.Time]: 4, [Svc.SetAngle]: 6, [Svc.StopSound]: 2,
  [Svc.Particle]: 11, [Svc.SetPause]: 1, [Svc.SignOnNum]: 1, [Svc.SpawnStaticSound]: 14, [Svc.Intermission]: 0,
  [Svc.Finale]: 1, [Svc.CdTrack]: 2, [Svc.WeaponAnim]: 2, [Svc.RoomType]: 2, [Svc.AddAngle]: 2, [Svc.Choke]: 0,
  [Svc.ResourceRequest]: 8, [Svc.CrosshairAngle]: 2, [Svc.SoundFade]: 4, [Svc.TimeScale]: 4,
};

// ---- per-message decoders: each leaves the reader just after the message ----

function readServerInfo(r: BitReader, s: ProtocolState): ServerInfoBody {
  const protocol = r.i32();
  const spawnCount = r.i32();
  const mungedMapChecksum = r.u32();
  const clientDllHash = r.bytesCopy(16);
  const maxClients = r.u8();
  const playerSlot = r.u8();
  const deathmatch = r.u8();
  const gameDir = r.string();
  const hostName = s.protocol > 43 ? r.string() : '';
  const mapName = r.string();
  let mapCycle = '';
  let extra: Uint8Array = new Uint8Array(0);
  if (s.protocol === 45 && r.bytes[r.byteOffset] === Svc.SendExtraInfo) {
    // Some protocol-45 servers omit the map cycle and extra block entirely.
  } else {
    mapCycle = r.string();
    if (s.protocol > 43) {
      const start = r.byteOffset;
      const flag = r.u8();
      if (flag > 0) r.skipBytes(s.protocol === 45 ? 36 : 21);
      extra = r.bytes.slice(start, r.byteOffset);
    }
  }
  s.maxClients = maxClients;
  return { kind: 'serverInfo', protocol, spawnCount, mungedMapChecksum, clientDllHash, maxClients, playerSlot, deathmatch, gameDir, hostName, mapName, mapCycle, extra };
}

function readUserInfo(r: BitReader, s: ProtocolState): UserInfoBody {
  const slot = r.u8();
  const userId = r.i32();
  const text = r.string();
  if (s.protocol > 43) r.skipBytes(16); // CD key hash
  const info: Record<string, string> = {};
  const parts = text.replace(/^\\/, '').split('\\');
  for (let i = 0; i + 1 < parts.length; i += 2) info[parts[i]] = parts[i + 1];
  return { kind: 'userInfo', slot, userId, info };
}

function readDeltaDescription(r: BitReader, s: ProtocolState): void {
  const name = r.string();
  const count = r.bits(16);
  const records: DeltaRecord[] = [];
  for (let i = 0; i < count; i++) records.push(DESCRIPTION_DESCRIPTOR.decode(r));
  r.alignToByte();
  s.deltas.set(name, descriptorFromRecords(name, records));
}

function readClientData(r: BitReader, s: ProtocolState): ClientDataBody | undefined {
  if (s.hltv) return undefined; // HLTV demos carry no client data payload
  const body: ClientDataBody = { kind: 'clientData', client: undefined!, weapons: [] };
  if (r.bool()) body.deltaSequence = r.u8();
  body.client = descriptor(s, 'clientdata_t').decode(r);
  const weapon = descriptor(s, 'weapon_data_t');
  while (r.bool()) body.weapons.push({ index: r.bits(s.weaponIndexBits), record: weapon.decode(r) });
  r.alignToByte();
  return body;
}

function readEntities(r: BitReader, s: ProtocolState, isDelta: boolean): EntitiesBody {
  const body: EntitiesBody = { kind: 'entities', isDelta, count: r.u16(), entities: [] };
  if (isDelta) body.deltaSequence = r.u8();
  let number = 0;
  for (;;) {
    const mark = r.bitOffset;
    if (r.u16() === 0) break; // 16 zero bits end the list
    r.seekBit(mark);
    const e: PacketEntity = { number: 0, numbering: { mode: 'next' }, remove: false, custom: false, descriptor: '' };
    if (isDelta) {
      e.remove = r.bool();
      e.numbering = r.bool() ? { mode: 'absolute', value: r.bits(11) } : { mode: 'relative', value: r.bits(6) };
    } else if (!r.bool()) {
      e.numbering = r.bool() ? { mode: 'absolute', value: r.bits(11) } : { mode: 'relative', value: r.bits(6) };
    }
    number = e.numbering.mode === 'absolute' ? e.numbering.value : e.numbering.mode === 'relative' ? number + e.numbering.value : number + 1;
    e.number = number;
    if (!e.remove) {
      e.custom = r.bool();
      if (!isDelta && r.bool()) e.baseline = r.bits(6);
      e.descriptor = entityDescriptor(s, number, e.custom);
      e.record = descriptor(s, e.descriptor).decode(r);
    }
    body.entities.push(e);
  }
  r.alignToByte();
  return body;
}

function readBaseline(r: BitReader, s: ProtocolState): BaselineBody {
  const body: BaselineBody = { kind: 'baseline', entities: [], extras: [] };
  for (;;) {
    const index = r.bits(11);
    if (index === 0x7ff) break;
    const type = r.bits(2);
    const name = type & 1 ? (index > 0 && index <= s.maxClients ? 'entity_state_player_t' : 'entity_state_t') : 'custom_entity_state_t';
    body.entities.push({ index, type, descriptor: name, record: descriptor(s, name).decode(r) });
  }
  if (r.bits(5) !== 0x1f) throw new FormatError('Malformed svc_spawnbaseline (bad end marker)');
  const extras = r.bits(6);
  const es = descriptor(s, 'entity_state_t');
  for (let i = 0; i < extras; i++) body.extras.push(es.decode(r));
  r.alignToByte();
  return body;
}

function readResourceList(r: BitReader): ResourceListBody {
  const count = r.bits(12);
  const resources: Resource[] = [];
  for (let i = 0; i < count; i++) {
    const res: Resource = { type: r.bits(4), name: r.string(), index: r.bits(12), size: r.bits(24), flags: r.bits(3) };
    if (res.flags & 4) res.md5 = r.bytesCopy(16);
    if (r.bool()) res.extra = r.bytesCopy(32);
    resources.push(res);
  }
  const hadConsistencyList = r.bool();
  if (hadConsistencyList) while (r.bool()) r.skipBits(r.bool() ? 5 : 10);
  r.alignToByte();
  return { kind: 'resourceList', resources, hadConsistencyList };
}

function readEvents(r: BitReader, s: ProtocolState): EventsBody {
  const count = r.bits(5);
  const ev = descriptor(s, 'event_t');
  const body: EventsBody = { kind: 'events', events: [] };
  for (let i = 0; i < count; i++) {
    const e: EventsBody['events'][number] = { index: r.bits(10) };
    if (r.bool()) {
      e.entity = r.bits(11);
      if (r.bool()) e.record = ev.decode(r);
    }
    if (r.bool()) e.fireTime = r.bits(16);
    body.events.push(e);
  }
  r.alignToByte();
  return body;
}

function readSound(r: BitReader): SoundBody {
  const flags = r.bits(9);
  if (flags & 1) r.skipBits(8); // volume
  if (flags & 2) r.skipBits(8); // attenuation
  const channel = r.bits(3);
  const entity = r.bits(11);
  const sound = r.bits(flags & 4 ? 16 : 8);
  const axes = [r.bool(), r.bool(), r.bool()];
  const origin: SoundBody['origin'] = [undefined, undefined, undefined];
  axes.forEach((present, i) => {
    if (!present) return;
    const hasInt = r.bool();
    const hasFrac = r.bool();
    if (!hasInt && !hasFrac) { origin[i] = 0; return; }
    const negative = r.bool();
    const whole = hasInt ? r.bits(12) : 0;
    const frac = hasFrac ? r.bits(3) : 0;
    const v = whole + frac / 8;
    origin[i] = negative ? -v : v;
  });
  if (flags & 8) r.skipBits(8); // pitch
  r.alignToByte();
  return { kind: 'sound', entity, channel, sound, origin };
}

function skipTempEntity(r: BitReader): void {
  const type = r.u8();
  if (type === 13) {
    // TE_BSPDECAL: position, decal, entity, (model if entity != 0)
    r.skipBytes(8);
    if (r.u16() !== 0) r.skipBytes(2);
    return;
  }
  if (type === 29) {
    // TE_TEXTMESSAGE
    r.skipBytes(5);
    const effect = r.u8();
    r.skipBytes(14);
    if (effect === 2) r.skipBytes(2);
    r.string();
    return;
  }
  const size = TEMP_ENTITY_SIZE[type];
  if (size === undefined) throw new FormatError(`Unknown temporary entity type ${type}`);
  r.skipBytes(size);
}

function decodeOne(r: BitReader, id: number, s: ProtocolState): MessageBody | undefined {
  const fixed = FIXED_SIZE[id];
  if (fixed !== undefined) {
    r.skipBytes(fixed);
    return undefined;
  }
  switch (id) {
    case Svc.Disconnect: case Svc.Print: case Svc.CenterPrint: case Svc.FileTransferFailed:
    case Svc.ResourceLocation: case Svc.SendCvarValue:
      r.string();
      return undefined;
    case Svc.StuffText:
      return { kind: 'text', text: r.string() };
    case Svc.SendCvarValue2: r.skipBytes(4); r.string(); return undefined;
    case Svc.LightStyle: r.skipBytes(1); r.string(); return undefined;
    case Svc.Event: return readEvents(r, s);
    case Svc.EventReliable: {
      r.skipBits(10);
      descriptor(s, 'event_t').decode(r);
      if (r.bool()) r.skipBits(16);
      r.alignToByte();
      return undefined;
    }
    case Svc.Sound: return readSound(r);
    case Svc.ServerInfo: return readServerInfo(r, s);
    case Svc.UpdateUserInfo: return readUserInfo(r, s);
    case Svc.DeltaDescription: readDeltaDescription(r, s); return undefined;
    case Svc.ClientData: return readClientData(r, s);
    case Svc.Pings: while (r.bool()) r.skipBits(24); r.alignToByte(); return undefined;
    case Svc.SpawnStatic: { r.skipBytes(18); if (r.u8() !== 0) r.skipBytes(5); return undefined; }
    case Svc.SpawnBaseline: return readBaseline(r, s);
    case Svc.TempEntity: skipTempEntity(r); return undefined;
    case Svc.NewUserMsg: {
      const id = r.u8();
      const size = r.i8();
      const nameField = r.bytesCopy(16);
      const end = nameField.indexOf(0);
      let name = '';
      for (const c of end < 0 ? nameField : nameField.subarray(0, end)) name += String.fromCharCode(c);
      const def: UserMessageDef = { id, size, name };
      s.userMessages.set(def.id, def);
      return { kind: 'newUserMsg', def, nameField };
    }
    case Svc.PacketEntities: return readEntities(r, s, false);
    case Svc.DeltaPacketEntities: return readEntities(r, s, true);
    case Svc.ResourceList: return readResourceList(r);
    case Svc.NewMoveVars: r.skipBytes(98); r.string(); return undefined;
    case Svc.Customization: r.skipBytes(2); r.string(); r.skipBytes(23); return undefined;
    case Svc.Hltv: {
      s.hltv = true;
      const command = r.u8();
      if (command === 2) r.skipBytes(8);
      return { kind: 'hltv', command };
    }
    case Svc.Director: return { kind: 'director', data: r.bytesCopy(r.u8()) };
    case Svc.VoiceInit: {
      const codec = r.string();
      const quality = s.protocol >= 47 || s.betaSteam ? r.u8() : undefined;
      return { kind: 'voiceInit', codec, quality };
    }
    case Svc.VoiceData: {
      const slot = r.u8();
      return { kind: 'voiceData', slot, data: r.bytesCopy(r.u16()) };
    }
    case Svc.SendExtraInfo: r.string(); r.skipBytes(1); return undefined;
  }
  const def = s.userMessages.get(id);
  if (!def) throw new FormatError(`Unknown message id ${id}`);
  const sized = def.size === -1;
  const size = sized ? r.u8() : def.size;
  return { kind: 'user', name: def.name, payload: r.bytesCopy(size), sized };
}

/** Decodes every message in one frame. Throws MessageError (with the messages decoded so far) on failure. */
export function decodeMessages(bytes: Uint8Array, s: ProtocolState): Message[] {
  const r = new BitReader(bytes);
  const out: Message[] = [];
  while (!r.atEnd) {
    const start = r.byteOffset;
    const id = r.u8();
    const name = svcName(id) ?? s.userMessages.get(id)?.name ?? `unknown_${id}`;
    try {
      const body = decodeOne(r, id, s);
      out.push({ id, name, start, end: r.byteOffset, body });
    } catch (e) {
      throw new MessageError(`${(e as Error).message} (in ${name} at byte ${start})`, start, out);
    }
    if (id >= FIRST_USER_MESSAGE_ID && !s.userMessages.has(id)) throw new MessageError(`Unknown message id ${id}`, start, out);
  }
  return out;
}

/** Re-assembles a frame's message data: original bytes for untouched messages, new bytes where replaced. */
export function encodeMessages(original: Uint8Array, messages: readonly Message[]): Uint8Array {
  const parts: Uint8Array[] = messages.map((m) => {
    if (m.bytes) return m.bytes;
    if (m.start === undefined || m.end === undefined) throw new Error(`Message ${m.name} has neither original bytes nor a replacement`);
    return original.subarray(m.start, m.end);
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
