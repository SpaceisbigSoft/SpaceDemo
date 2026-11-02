// Converts a 1999 demo (demo format 4, network protocol 38-40: Half-Life 1.0.0.9/1.0.1.0/1.0.1.3/1.0.1.6, CS betas 1.0-6.2) into a
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
import { betaPlayerSequence } from '../transforms/beta-sequences.js';
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
    // Animations: the 1999 player.mdl list starts like beta 6.6's (Half-Life's names); matched by name to CS 1.6's.
    modelindex: p.modelindex ?? playerModel, sequence: betaPlayerSequence(p.sequence ?? 0, 41), gaitsequence: betaPlayerSequence(p.gaitsequence, 41), frame: p.frame,
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
  viewmodel: number;
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
  tick: Tick = { time: 0, origin: [0, 0, 0], angles: [0, 0, 0], velocity: [0, 0, 0], viewheight: 17, health: 100, onground: false, waterlevel: 0, msec: 0, buttons: 0, items: 0, fov: 90, viewmodel: 0 };

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
      this.tick.viewmodel = cd.weaponframe;
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

  private readonly teams = new Map<number, number>();
  private fadeHeld = false;
  private screenFadeId?: number;

  /**
   * Game (user) messages whose 1999 layout today's CS client reads differently. Returns the payload(s) to send and an
   * optional extra message to put after it.
   */
  private userMessage(name: string, p: Uint8Array): [Uint8Array, Uint8Array?][] {
    const TEAMS = ['UNASSIGNED', 'TERRORIST', 'CT', 'SPECTATOR'];
    const str = (t: string) => Uint8Array.from([...Buffer.from(t, 'latin1'), 0]);
    switch (name) {
      case 'TeamInfo':
        // 1999: slot + team number; today: slot + team name. A wrong name leaves the client without a team.
        if (p.length === 2 && p[1] < 4) {
          this.teams.set(p[0], p[1]);
          this.count('beta: team numbers -> names');
          return [[Uint8Array.from([p[0], ...str(TEAMS[p[1]])])]];
        }
        break;
      case 'TeamScore':
        if (p.length === 3 && p[0] < 4) {
          this.count('beta: team numbers -> names');
          return [[Uint8Array.from([...str(TEAMS[p[0]]), p[1], p[2]])]];
        }
        break;
      case 'ScoreInfo':
        // slot, frags, deaths + (today) class and team.
        if (p.length === 5) return [[Uint8Array.from([...p, 0, 0, this.teams.get(p[0]) ?? 0, 0])]];
        break;
      case 'DeathMsg':
        // killer, victim, (today: headshot byte), weapon name.
        if (p.length >= 3 && p[2] >= 0x20) {
          this.count('beta: kill message headshot byte');
          return [[Uint8Array.from([p[0], p[1], 0, ...p.subarray(2)])]];
        }
        break;
      case 'SendAudio':
        // Today's client reads a pitch after the sound name (100 = normal).
        this.count('radio audio: add pitch');
        return [[Uint8Array.from([...p, 100, 0])]];
      case 'ScreenFade': {
        // duration, hold, flags (u16 each), colour, alpha. The 1999 client lifted a "stay faded" screen (flag 4, sent
        // on joining) when the HUD was reset at spawn; today's client keeps it, so the screen stays black.
        const flags = p.length >= 6 ? p[4] | (p[5] << 8) : 0;
        this.fadeHeld = (flags & 4) !== 0;
        break;
      }
      case 'ResetHUD':
        if (this.fadeHeld && this.screenFadeId !== undefined) {
          this.fadeHeld = false;
          this.count('beta: lift held screen fade at spawn');
          return [[p, encodeUserMessage(this.screenFadeId, new Uint8Array(10), false)]];
        }
        break;
    }
    return [[p]];
  }

  /**
   * Gun animation numbers of the 1999 betas that mean something else on today's models. Read from beta 6.1's server
   * code (cs_i386.so from Ch0wW/counterstrike-betas csbeta61: the animation each Deploy, Reload, Fire and Swing asks
   * for) and compared with today's v_*.mdl animation lists (owner's game, 2026-11-02). Guns not listed use today's
   * numbers already (AK-47, AUG, MAC-10, MP5, SG552, TMP, P90, Scout, G3SG1, M249, Deagle, P228, Glock, M3, XM1014,
   * grenades, C4).
   *  - Knife: the beta swings with 1/2, which today are 2-frame "slash" stubs; the full swings are 6/7 (midslash).
   *  - AWP: the beta's reload 3 / draw 4 are today's 4 / 5 (today's model has a third shot at 3).
   *  - M4A1 and USP: no silencer in the beta; today's models start with the silenced animations, so the beta's are
   *    moved to the unsilenced ones. The beta USP has two sets (shoot 1-4/reload 5/draw 6, and draw 9/shoot 10/
   *    reload 11, chosen by its hand setting).
   */
  private static readonly GUN_ANIMS: [RegExp, Record<number, number>][] = [
    [/v_knife\.mdl$/, { 1: 6, 2: 7 }],
    [/v_awp\.mdl$/, { 3: 4, 4: 5 }],
    [/v_m4a1\.mdl$/, { 0: 7, 1: 11, 2: 12, 3: 8, 4: 9, 5: 10 }],
    [/v_usp\.mdl$/, { 0: 8, 1: 9, 2: 10, 3: 11, 4: 12, 5: 13, 6: 14, 9: 14, 10: 10, 11: 13 }],
  ];

  /**
   * Betas whose gun models differ from beta 6.1's, found by the client.dll checksum in their server info. Tables
   * match each beta model's animation names (its own v_*.mdl) to today's by name.
   *  - Beta 1.0 (1999-06-19, HL 1.0.1.0, checksum 2699062824; models from its pak0.pak, lab task 45): Glock lacks
   *    today's shoot3 (5-11 move up one); USP has the Glock's list (idle1-3, shoot, shoot_empty, reload, draw, holster,
   *    add_silencer, draw2, shoot2, reload2) → today's unsilenced set; M4A1 as 6.1 plus burst_shoot 6; AWP as 6.1;
   *    no knife model of its own.
   */
  private static readonly BETA_GUN_ANIMS: Record<number, [RegExp, Record<number, number>][]> = {
    2699062824: [
      [/v_awp\.mdl$/, { 3: 4, 4: 5 }],
      [/v_glock18\.mdl$/, { 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12 }],
      [/v_m4a1\.mdl$/, { 0: 7, 1: 11, 2: 12, 3: 8, 4: 9, 5: 10, 6: 8 }],
      [/v_usp\.mdl$/, { 0: 8, 1: 8, 2: 8, 3: 9, 4: 12, 5: 13, 6: 14, 7: 8, 8: 7, 9: 14, 10: 10, 11: 13 }],
    ],
  };

  /** client.dll checksum from the server info (picks the gun animation table). */
  private clientChecksum = 0;

  private gunAnim(seq: number): number {
    const model = (this.resources.find((r) => r.type === 2 && r.index === this.tick.viewmodel)?.name.toLowerCase() ?? '').replace(/_r\.mdl$/, '.mdl');
    for (const [re, map] of Converter.BETA_GUN_ANIMS[this.clientChecksum] ?? Converter.GUN_ANIMS) {
      if (!re.test(model) || map[seq] === undefined) continue;
      this.count(`beta: gun animation (${model.replace(/^models\/v_|\.mdl$/g, '')})`);
      return map[seq];
    }
    return seq;
  }

  /** View model animations of the frame just converted (sequence, body). */
  weaponAnims: [number, number][] = [];

  /** Converts one frame's messages. */
  frame(f: NetFrame4): Uint8Array[] {
    const msgs: Message40[] = decodeMessages40(f.messages, this.s);
    // The view model in use this frame (the client data names it) decides how gun animations are renumbered.
    for (const m of msgs) if (m.body?.kind === 'clientData') this.tick.viewmodel = m.body.weaponframe;
    this.weaponAnims = msgs.filter((m) => m.id === P40.WeaponAnim && m.payload.length >= 2).map((m) => [this.gunAnim(m.payload[0]), m.payload[1]]);
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
        this.clientChecksum = b.clientChecksum >>> 0;
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
        case 'newUserMsg': {
          // ScoreInfo grew from 5 to 9 bytes (class and team added).
          const size = b.name === 'ScoreInfo' && b.size === 5 ? 9 : b.size;
          if (size !== b.size) this.count('beta: ScoreInfo size');
          if (b.name === 'ScreenFade') this.screenFadeId = this.userId(b.id);
          out.push(encodeNewUserMsg({ id: this.userId(b.id), size, name: b.name }, b.nameField));
          continue;
        }
        case 'user':
          if (b.name === 'SetFOV' && b.payload.length) this.fov = b.payload[0] || 90;
          for (const [payload, extra] of this.userMessage(b.name, b.payload)) {
            out.push(encodeUserMessage(this.userId(m.id), payload, b.sized));
            if (extra) out.push(extra);
          }
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
      if (m.id === P40.WeaponAnim && m.payload.length >= 2) {
        out.push(Uint8Array.of(Svc.WeaponAnim, this.gunAnim(m.payload[0]), m.payload[1]));
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
    // ref_params (after a 4-byte timestamp): vieworg (eye) 4, viewangles 16, view vectors 28-63, viewsize 160, frametime 64, time 68, onground 84,
    // waterlevel 88, simvel 92, simorg 104, viewheight 116, cl_viewangles 132, health 144, maxclients 176,
    // viewentity 180, playernum 184, max_entities 188. Then usercmd at 236 (msec 238, viewangles 240, buttons 266),
    // movevars at 288 (132 bytes), eye position 420, view model 432, and the 28-byte sequence info at 436.
    const eye = [t.origin[0], t.origin[1], t.origin[2] + t.viewheight];
    f3(4, eye);
    f3(16, angles);
    // forward / right / up vectors of the view (28, 40, 52), as the game's AngleVectors makes them.
    const [p, y, r] = angles.map((a) => (a * Math.PI) / 180);
    const [sp, cp, sy, cy, sr, cr] = [Math.sin(p), Math.cos(p), Math.sin(y), Math.cos(y), Math.sin(r), Math.cos(r)];
    f3(28, [cp * cy, cp * sy, -sp]);
    f3(40, [-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp]);
    f3(52, [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp]);
    // Screen size: 120 = full screen (every real demo has it; with 0 the gun isn't drawn).
    dv.setInt32(160, 120, true);
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
    // View position (eye) and view model index: the game draws the gun from these while playing a demo
    // (measured on a protocol-41 demo converted to 48: 420 = eye position, 432 = the clientdata's view model).
    f3(420, eye);
    dv.setInt32(432, t.viewmodel, true);
    if (seq) out.set(seq.subarray(0, 28), 436);
    return out;
  }

  /**
   * The game client's own demo data (frame type 9): length 8, type 1 = zoom, field of view. While playing a demo, the
   * CS client takes its field of view from this, not from SetFOV; without it the view counts as zoomed in and the gun
   * isn't drawn. Real POV demos carry one every frame (seen in the protocol-41 recordings).
   */
  zoomBuffer(): Uint8Array {
    const out = new Uint8Array(12);
    const dv = new DataView(out.buffer);
    dv.setInt32(0, 8, true);
    dv.setInt32(4, 1, true);
    dv.setFloat32(8, this.fov, true);
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
  return protocol >= 38 && protocol <= 40;
}

export function convert1999(input: Uint8Array | Demo4, options: Convert1999Options = {}): { demo: DemoFile; report: UpgradeReport } {
  const d = input instanceof Uint8Array ? readDemo4(input) : input;
  const P = d.header.networkProtocol;
  if (!isConvertible1999(P)) throw new Error(`Network protocol ${P} (1999) is not supported yet (supported: 38-40).`);
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
            frames.push({ type: FrameType.DemoBuffer, time: f.time, index: f.index, payload: c.zoomBuffer() });
            frames.push({ type: FrameType.ClientData, time: f.time, index: f.index, payload: c.clientFrame() });
            // Today's game animates the gun in a demo from weapon-animation frames (the client recorded its own
            // animations), not from the server's svc_weaponanim: one frame per animation, in the order real recordings have
            // them (zoom data, client data, animations, messages).
            for (const [seq, body] of c.weaponAnims) {
              const payload = new Uint8Array(8);
              const dv = new DataView(payload.buffer);
              dv.setInt32(0, seq, true);
              dv.setInt32(4, body, true);
              frames.push({ type: FrameType.WeaponAnimation, time: f.time, index: f.index, payload });
              c.count('gun animation frames');
            }
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
