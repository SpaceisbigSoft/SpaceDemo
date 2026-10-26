// Encoders for the messages that transforms rewrite. Each returns the full message bytes, id included.
import { BitWriter } from '../binary/bits.js';
import type { DeltaDescriptor } from './delta.js';
import { Svc } from './ids.js';
import type { BaselineBody, ClientDataBody, EntitiesBody, ResourceListBody, ServerInfoBody, UserMessageDef } from './messages.js';

type Deltas = ReadonlyMap<string, DeltaDescriptor>;

function need(deltas: Deltas, name: string): DeltaDescriptor {
  const d = deltas.get(name);
  if (!d) throw new Error(`Delta description "${name}" is missing`);
  return d;
}

function i32(w: BitWriter, v: number): void {
  w.bits(v < 0 ? v + 2 ** 32 : v, 32);
}

export interface ServerInfoOptions {
  /** Protocol number to write; layout follows protocol 44+ (host name present). */
  protocol: number;
  /** Replace the trailing extra-info block (e.g. with a single 0 flag byte). */
  extra?: Uint8Array;
}

export function encodeServerInfo(b: ServerInfoBody, o: ServerInfoOptions): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.ServerInfo);
  i32(w, o.protocol);
  i32(w, b.spawnCount);
  w.u32(b.mungedMapChecksum);
  w.bytes(b.clientDllHash);
  w.u8(b.maxClients);
  w.u8(b.playerSlot);
  w.u8(b.deathmatch);
  w.string(b.gameDir);
  w.string(b.hostName);
  w.string(b.mapName);
  w.string(b.mapCycle);
  w.bytes(o.extra ?? b.extra);
  return w.finish();
}

/** `nameField` (the original 16 bytes) is reused when given, so unchanged names are written back exactly. */
export function encodeNewUserMsg(def: UserMessageDef, nameField?: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.NewUserMsg);
  w.u8(def.id);
  w.u8(def.size & 0xff);
  if (nameField) w.bytes(nameField);
  else w.fixedString(def.name, 16);
  return w.finish();
}

export function encodeVoiceInit(codec: string, quality?: number): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.VoiceInit);
  w.string(codec);
  if (quality !== undefined) w.u8(quality);
  return w.finish();
}

export function encodeUserMessage(id: number, payload: Uint8Array, sized: boolean): Uint8Array {
  const w = new BitWriter();
  w.u8(id);
  if (sized) w.u8(payload.length);
  w.bytes(payload);
  return w.finish();
}

export function encodeDirector(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.Director);
  w.u8(data.length);
  w.bytes(data);
  return w.finish();
}

export function encodeClientData(b: ClientDataBody, deltas: Deltas, weaponIndexBits: number): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.ClientData);
  w.bool(b.deltaSequence !== undefined);
  if (b.deltaSequence !== undefined) w.u8(b.deltaSequence);
  need(deltas, 'clientdata_t').encode(w, b.client);
  const weapon = need(deltas, 'weapon_data_t');
  for (const wd of b.weapons) {
    w.bool(true);
    w.bits(wd.index, weaponIndexBits);
    weapon.encode(w, wd.record);
  }
  w.bool(false);
  w.alignToByte();
  return w.finish();
}

export function encodeEntities(b: EntitiesBody, deltas: Deltas): Uint8Array {
  const w = new BitWriter();
  w.u8(b.isDelta ? Svc.DeltaPacketEntities : Svc.PacketEntities);
  w.u16(b.count);
  if (b.isDelta) w.u8(b.deltaSequence ?? 0);
  for (const e of b.entities) {
    if (b.isDelta) {
      w.bool(e.remove);
      if (e.numbering.mode === 'next') throw new Error('Delta packet entities cannot use implicit numbering');
      w.bool(e.numbering.mode === 'absolute');
      w.bits(e.numbering.value, e.numbering.mode === 'absolute' ? 11 : 6);
    } else {
      w.bool(e.numbering.mode === 'next');
      if (e.numbering.mode !== 'next') {
        w.bool(e.numbering.mode === 'absolute');
        w.bits(e.numbering.value, e.numbering.mode === 'absolute' ? 11 : 6);
      }
    }
    if (e.remove) continue;
    w.bool(e.custom);
    if (!b.isDelta) {
      w.bool(e.baseline !== undefined);
      if (e.baseline !== undefined) w.bits(e.baseline, 6);
    }
    need(deltas, e.descriptor).encode(w, e.record!);
  }
  w.u16(0);
  w.alignToByte();
  return w.finish();
}

export function encodeBaseline(b: BaselineBody, deltas: Deltas): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.SpawnBaseline);
  for (const e of b.entities) {
    w.bits(e.index, 11);
    w.bits(e.type, 2);
    need(deltas, e.descriptor).encode(w, e.record);
  }
  w.bits(0x7ff, 11);
  w.bits(0x1f, 5);
  w.bits(b.extras.length, 6);
  const es = need(deltas, 'entity_state_t');
  for (const x of b.extras) es.encode(w, x);
  w.alignToByte();
  return w.finish();
}

/** Encodes a resource list. The consistency list is never written (current clients don't need it for playback). */
export function encodeResourceList(b: ResourceListBody): Uint8Array {
  const w = new BitWriter();
  w.u8(Svc.ResourceList);
  w.bits(b.resources.length, 12);
  for (const r of b.resources) {
    w.bits(r.type, 4);
    w.string(r.name);
    w.bits(r.index, 12);
    w.bits(r.size, 24);
    w.bits(r.flags, 3);
    if (r.md5) w.bytes(r.md5);
    w.bool(r.extra !== undefined);
    if (r.extra) w.bytes(r.extra);
  }
  w.bool(false);
  w.alignToByte();
  return w.finish();
}
