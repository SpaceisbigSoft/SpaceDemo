// GoldSrc engine/user network message parser.
// Ported from compLexity Demo Player (HalfLifeDemoParser.cs, HalfLifeDemo.cs), GPL v3.
// This version only reads (it does not rewrite messages) and reports what it finds.
import { BitBuffer } from './bitbuffer.js';
import { DeltaStructure, createDeltaDescriptionStructure } from './delta.js';

export const Svc = {
  nop: 1, disconnect: 2, event: 3, version: 4, setview: 5, sound: 6, time: 7, print: 8, stufftext: 9,
  setangle: 10, serverinfo: 11, lightstyle: 12, updateuserinfo: 13, deltadescription: 14, clientdata: 15,
  stopsound: 16, pings: 17, particle: 18, spawnstatic: 20, event_reliable: 21, spawnbaseline: 22,
  tempentity: 23, setpause: 24, signonnum: 25, centerprint: 26, spawnstaticsound: 29, intermission: 30,
  finale: 31, cdtrack: 32, weaponanim: 35, roomtype: 37, addangle: 38, newusermsg: 39, packetentities: 40,
  deltapacketentities: 41, choke: 42, resourcelist: 43, newmovevars: 44, resourcerequest: 45,
  customization: 46, crosshairangle: 47, soundfade: 48, filetxferfailed: 49, hltv: 50, director: 51,
  voiceinit: 52, voicedata: 53, sendextrainfo: 54, timescale: 55, resourcelocation: 56, sendcvarvalue: 57,
  sendcvarvalue2: 58,
} as const;

const SVC_NAMES: Record<number, string> = Object.fromEntries(Object.entries(Svc).map(([k, v]) => [v, 'svc_' + k]));

export interface ServerInfo {
  networkProtocol: number;
  mungedMapChecksum: number;
  clientDllChecksum: string;
  maxClients: number;
  recorderSlot: number;
  gameDir: string;
  serverName: string;
  mapName: string;
}

export interface PlayerInfo {
  slot: number;
  id: number;
  name: string;
  infoKeys: Record<string, string>;
}

export interface VoiceInit {
  codec: string;
  quality?: number;
  time: number;
}

export interface VoicePacket {
  slot: number;
  time: number;
  data: Uint8Array;
}

export interface ParseContext {
  networkProtocol: number;
  gameDir: string;
  /** True for beta-Steam demos (protocol 46 recorded with a 1.6 client.dll, and some 47 demos). */
  betaSteam: boolean;
  hltv: boolean;
}

/** Message-level callbacks so callers can collect what they need. */
export interface MessageListener {
  serverInfo?(info: ServerInfo): void;
  userInfo?(p: PlayerInfo): void;
  voiceInit?(v: VoiceInit): void;
  voiceData?(v: VoicePacket): void;
  userMessage?(name: string, data: Uint8Array, time: number): void;
  stuffText?(text: string, time: number): void;
  hltv?(): void;
  message?(id: number, name: string): void;
}

interface UserMessageDef {
  id: number;
  length: number;
  name: string;
}

export class MessageParser {
  private deltas = new Map<string, DeltaStructure>();
  private userMessages = new Map<number, UserMessageDef>();
  private bb!: BitBuffer;
  private time = 0;
  maxClients = 32;

  constructor(private ctx: ParseContext, private listener: MessageListener = {}) {
    const dd = createDeltaDescriptionStructure();
    this.deltas.set(dd.name, dd);
  }

  get userMessageTable(): UserMessageDef[] {
    return [...this.userMessages.values()];
  }

  private delta(name: string): DeltaStructure {
    const d = this.deltas.get(name);
    if (!d) throw new Error(`Delta structure "${name}" not found`);
    return d;
  }

  private old(): boolean {
    return this.ctx.networkProtocol <= 43;
  }

  /** Parses all messages in one game data frame. Throws on an unknown or malformed message. */
  parseFrame(data: Uint8Array, time: number): void {
    this.bb = new BitBuffer(data);
    this.time = time;
    const bb = this.bb;
    while (bb.currentByte < bb.length) {
      const id = bb.readByte();
      const name = SVC_NAMES[id] ?? this.userMessages.get(id)?.name ?? `unknown_${id}`;
      this.listener.message?.(id, name);
      this.handle(id);
      bb.bigEndian = false;
    }
  }

  private seek(n: number): void {
    this.bb.seekBytes(n);
  }

  private handle(id: number): void {
    const bb = this.bb;
    const P = this.ctx.networkProtocol;
    switch (id) {
      case Svc.nop: case Svc.intermission: case Svc.choke: return;
      case Svc.disconnect: bb.readString(); return;
      case Svc.event: return this.event();
      case Svc.version: return this.seek(4);
      case Svc.setview: return this.seek(2);
      case Svc.sound: return this.sound();
      case Svc.time: return this.seek(4);
      case Svc.print: bb.readString(); return;
      case Svc.stufftext: { const s = bb.readString(); this.listener.stuffText?.(s, this.time); return; }
      case Svc.setangle: return this.seek(6);
      case Svc.serverinfo: return this.serverInfo();
      case Svc.lightstyle: this.seek(1); bb.readString(); return;
      case Svc.updateuserinfo: return this.updateUserInfo();
      case Svc.deltadescription: return this.deltaDescription();
      case Svc.clientdata: return this.clientData();
      case Svc.stopsound: return this.seek(2);
      case Svc.pings: return this.pings();
      case Svc.particle: return this.seek(11);
      case Svc.spawnstatic: { this.seek(18); if (bb.readByte() !== 0) this.seek(5); return; }
      case Svc.event_reliable: return this.eventReliable();
      case Svc.spawnbaseline: return this.spawnBaseline();
      case Svc.tempentity: return this.tempEntity();
      case Svc.setpause: return this.seek(1);
      case Svc.signonnum: return this.seek(1);
      case Svc.centerprint: bb.readString(); return;
      case Svc.spawnstaticsound: return this.seek(14);
      case Svc.finale: return this.seek(1);
      case Svc.cdtrack: case Svc.weaponanim: case Svc.roomtype: case Svc.addangle: case Svc.crosshairangle: return this.seek(2);
      case Svc.newusermsg: return this.newUserMsg();
      case Svc.packetentities: return this.packetEntities();
      case Svc.deltapacketentities: return this.deltaPacketEntities();
      case Svc.resourcelist: return this.resourceList();
      case Svc.newmovevars: this.seek(98); bb.readString(); return;
      case Svc.resourcerequest: return this.seek(8);
      case Svc.customization: this.seek(2); bb.readString(); this.seek(23); return;
      case Svc.soundfade: return this.seek(4);
      case Svc.filetxferfailed: bb.readString(); return;
      case Svc.hltv: {
        this.ctx.hltv = true;
        this.listener.hltv?.();
        const sub = bb.readByte();
        if (sub === 2) this.seek(8);
        return;
      }
      case Svc.director: return this.seek(bb.readByte());
      case Svc.voiceinit: {
        const codec = bb.readString();
        let quality: number | undefined;
        if (P >= 47 || this.ctx.betaSteam) quality = bb.readByte();
        this.listener.voiceInit?.({ codec, quality, time: this.time });
        return;
      }
      case Svc.voicedata: {
        const slot = bb.readByte();
        const len = bb.readUInt16();
        const data = bb.readBytes(len);
        this.listener.voiceData?.({ slot, time: this.time, data });
        return;
      }
      case Svc.sendextrainfo: bb.readString(); this.seek(1); return;
      case Svc.timescale: return this.seek(4);
      case Svc.resourcelocation: bb.readString(); return;
      case Svc.sendcvarvalue: bb.readString(); return;
      case Svc.sendcvarvalue2: this.seek(4); bb.readString(); return;
    }
    // user messages
    const um = this.userMessages.get(id);
    if (!um) throw new Error(`Unknown message id ${id}`);
    const len = um.length === -1 ? bb.readByte() : um.length;
    const data = bb.readBytes(len);
    this.listener.userMessage?.(um.name, data, this.time);
  }

  private event(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    const n = bb.readUnsignedBits(5);
    for (let i = 0; i < n; i++) {
      bb.seekBits(10);
      if (bb.readBoolean()) {
        bb.seekBits(11);
        if (bb.readBoolean()) this.delta('event_t').read(bb);
      }
      if (bb.readBoolean()) bb.seekBits(16);
    }
    bb.skipRemainingBits();
  }

  private sound(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    const flags = bb.readUnsignedBits(9);
    if (flags & 1) bb.seekBits(8);
    if (flags & 2) bb.seekBits(8);
    bb.seekBits(3);
    bb.seekBits(11);
    bb.seekBits(flags & 4 ? 16 : 8);
    bb.readVectorCoord();
    if (flags & 8) bb.seekBits(8);
    bb.skipRemainingBits();
  }

  private serverInfo(): void {
    const bb = this.bb;
    const P = this.ctx.networkProtocol;
    const networkProtocol = bb.readInt32();
    this.seek(4); // process count
    const mungedMapChecksum = bb.readUInt32();
    const cs = bb.readBytes(16);
    const clientDllChecksum = Buffer.from(cs).toString('hex').toUpperCase();
    const maxClients = bb.readByte();
    const recorderSlot = bb.readByte();
    this.seek(1);
    const gameDir = bb.readString();
    const serverName = P > 43 ? bb.readString() : 'Unknown';
    const mapName = bb.readString();
    if (P === 45) {
      const extra = bb.readByte();
      this.seek(-1);
      if (extra !== Svc.sendextrainfo) {
        bb.readString();
        if (bb.readByte() > 0) this.seek(36);
      }
    } else {
      bb.readString(); // mapcycle
      if (P > 43 && bb.readByte() > 0) this.seek(21);
    }
    this.maxClients = maxClients;
    this.listener.serverInfo?.({ networkProtocol, mungedMapChecksum, clientDllChecksum, maxClients, recorderSlot, gameDir, serverName, mapName });
  }

  private updateUserInfo(): void {
    const bb = this.bb;
    const slot = bb.readByte();
    const id = bb.readInt32();
    const s = bb.readString();
    if (this.ctx.networkProtocol > 43) this.seek(16);
    const infoKeys: Record<string, string> = {};
    const tokens = s.replace(/^\\/, '').split('\\');
    for (let i = 0; i + 1 < tokens.length; i += 2) infoKeys[tokens[i]] = tokens[i + 1];
    this.listener.userInfo?.({ slot, id, name: infoKeys['name'] ?? '', infoKeys });
  }

  private deltaDescription(): void {
    const bb = this.bb;
    const name = bb.readString();
    if (this.ctx.networkProtocol === 43) bb.bigEndian = true;
    const n = bb.readUnsignedBits(16);
    const s = new DeltaStructure(name);
    const dd = this.delta('delta_description_t');
    for (let i = 0; i < n; i++) {
      const v = new Map<string, number | string>();
      dd.read(bb, v);
      s.addEntry(String(v.get('name') ?? ''), Number(v.get('nBits') ?? 0), Number(v.get('divisor') ?? 1), Number(v.get('flags') ?? 0) >>> 0);
    }
    this.deltas.set(name, s);
    bb.skipRemainingBits();
  }

  private clientData(): void {
    if (this.ctx.hltv) return;
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    if (bb.readBoolean()) bb.seekBits(8);
    this.delta('clientdata_t').read(bb);
    const weaponBits = this.ctx.networkProtocol < 47 && !this.ctx.betaSteam ? 5 : 6;
    while (bb.readBoolean()) {
      bb.seekBits(weaponBits);
      this.delta('weapon_data_t').read(bb);
    }
    bb.skipRemainingBits();
  }

  private pings(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    while (bb.readBoolean()) bb.seekBits(24);
    bb.skipRemainingBits();
  }

  private eventReliable(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    bb.seekBits(10);
    this.delta('event_t').read(bb);
    if (bb.readBoolean()) bb.seekBits(16);
    bb.skipRemainingBits();
  }

  private spawnBaseline(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    for (;;) {
      const idx = bb.readUnsignedBits(11);
      if (idx === (1 << 11) - 1) break;
      const type = bb.readUnsignedBits(2);
      let st: string;
      if (type & 1) st = idx > 0 && idx <= this.maxClients ? 'entity_state_player_t' : 'entity_state_t';
      else st = 'custom_entity_state_t';
      this.delta(st).read(bb);
    }
    if (bb.readUnsignedBits(5) !== (1 << 5) - 1) throw new Error('Bad svc_spawnbaseline footer');
    const nExtra = bb.readUnsignedBits(6);
    for (let i = 0; i < nExtra; i++) this.delta('entity_state_t').read(bb);
    bb.skipRemainingBits();
  }

  private tempEntity(): void {
    const bb = this.bb;
    const type = bb.readByte();
    const fixed: Record<number, number> = {
      16: 0, 26: 0, 2: 6, 4: 6, 9: 6, 10: 6, 11: 6, 0: 24, 1: 20, 3: 11, 5: 10, 6: 12, 7: 17, 8: 16, 12: 8,
      14: 9, 15: 19, 17: 10, 18: 16, 19: 24, 20: 24, 21: 24, 22: 10, 23: 11, 24: 16, 25: 19, 27: 12, 28: 16,
      30: 17, 31: 17, 99: 2, 100: 10, 101: 14, 102: 12, 103: 14, 104: 9, 105: 5, 106: 17, 107: 13, 108: 24,
      109: 9, 110: 17, 111: 7, 112: 10, 113: 19, 114: 19, 115: 12, 116: 7, 117: 7, 118: 9, 119: 16, 120: 18,
      121: 5, 122: 10, 123: 9, 124: 7, 125: 1, 126: 18, 127: 15,
    };
    if (type === 13) { // TE_BSPDECAL
      this.seek(8);
      if (bb.readUInt16() !== 0) this.seek(2);
      return;
    }
    if (type === 29) { // TE_TEXTMESSAGE
      this.seek(5);
      const effect = bb.readByte();
      this.seek(14);
      if (effect === 2) this.seek(2);
      bb.readString();
      return;
    }
    const n = fixed[type];
    if (n === undefined) throw new Error(`Unknown tempentity type ${type}`);
    this.seek(n);
  }

  private newUserMsg(): void {
    const bb = this.bb;
    const id = bb.readByte();
    const length = bb.readSByte();
    const name = bb.readFixedString(16);
    this.userMessages.set(id, { id, length, name });
  }

  private entityType(n: number, custom: boolean): string {
    if (n > 0 && n <= this.maxClients) return 'entity_state_player_t';
    return custom ? 'custom_entity_state_t' : 'entity_state_t';
  }

  private packetEntities(): void {
    const bb = this.bb;
    bb.seekBits(16);
    if (this.old()) bb.bigEndian = true;
    let n = 0;
    for (;;) {
      if (bb.readUInt16() === 0) break;
      bb.seekBits(-16);
      if (!bb.readBoolean()) {
        if (bb.readBoolean()) n = bb.readUnsignedBits(11);
        else n += bb.readUnsignedBits(6);
      } else n++;
      if (this.ctx.gameDir === 'tfc') bb.readBoolean();
      const custom = bb.readBoolean();
      if (bb.readBoolean()) bb.seekBits(6);
      this.delta(this.entityType(n, custom)).read(bb);
    }
    bb.skipRemainingBits();
  }

  private deltaPacketEntities(): void {
    const bb = this.bb;
    bb.seekBits(16);
    bb.seekBits(8);
    if (this.old()) bb.bigEndian = true;
    let n = 0;
    for (;;) {
      if (bb.readUInt16() === 0) break;
      bb.seekBits(-16);
      const remove = bb.readBoolean();
      if (bb.readBoolean()) n = bb.readUnsignedBits(11);
      else n += bb.readUnsignedBits(6);
      if (!remove) {
        if (this.ctx.gameDir === 'tfc') bb.readBoolean();
        const custom = bb.readBoolean();
        if (this.old()) bb.seekBits(1);
        this.delta(this.entityType(n, custom)).read(bb);
      }
    }
    bb.skipRemainingBits();
  }

  private resourceList(): void {
    const bb = this.bb;
    if (this.old()) bb.bigEndian = true;
    const n = bb.readUnsignedBits(12);
    for (let i = 0; i < n; i++) {
      bb.seekBits(4);
      bb.readString();
      bb.seekBits(36);
      const flags = bb.readUnsignedBits(3);
      if (flags & 4) bb.seekBytes(16);
      if (bb.readBoolean()) bb.seekBytes(32);
    }
    if (bb.readBoolean()) {
      while (bb.readBoolean()) bb.seekBits(bb.readBoolean() ? 5 : 10);
    }
    bb.skipRemainingBits();
  }
}
