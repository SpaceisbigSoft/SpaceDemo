// Extracts match information from a demo in one pass (plan 2.12). Layouts and their evidence: docs/FORMAT.md.
// Data from before the last match restart (warm-up, "restart in 3 seconds") is dropped from rounds, kills, deaths,
// bomb events and shots; chat, radio and voice are kept for the whole demo (with `round` undefined before the match).
import { FrameType, type DemoFile } from '../container/types.js';
import { createState, decodeMessages, type EventsBody } from '../protocol/messages.js';
import { Svc } from '../protocol/ids.js';
import { EntityTracker, incomingSequence } from './entities.js';
import { PayloadReader } from './payload.js';
import type { AimData, NetData, Grenade, BombEvent, ChatLine, Death, Kill, MatchCheck, MatchData, MatchPlayer, PlayerTrack, RecorderData, Round, RoundEndReason, Team, TrackPoint, VoiceBurst } from './types.js';

export interface ExtractOptions {
  /** Also build position tracks (plan 2.13). Costs time and memory on long demos. */
  tracks?: boolean;
  /** Maximum seen-positions per second per player (default 10). */
  samplesPerSecond?: number;
  /** 5.u Also keep the recorder's view every frame, his exact shot times and every packet's player positions (POV). */
  aim?: boolean;
}

/** Voice packets further apart than this start a new talk burst. */
const BURST_GAP = 0.3;
/** RoundTime values up to this many seconds are freeze time (a new round); longer values are the round length. */
const MAX_FREEZE_SECONDS = 15;
/** A restart after this many completed rounds ends a half (kept); fewer = warm-up or live-on-three (dropped). */
const HALF_ROUNDS = 5;

const ROUND_END: Record<string, [Round['winner'], RoundEndReason]> = {
  '#Terrorists_Win': ['T', 'eliminated'],
  '#CTs_Win': ['CT', 'eliminated'],
  '#Target_Bombed': ['T', 'bomb exploded'],
  '#Bomb_Defused': ['CT', 'bomb defused'],
  '#Target_Saved': ['CT', 'time ran out'],
  '#Round_Draw': ['draw', 'draw'],
  '#Hostages_Not_Rescued': ['T', 'time ran out'],
  '#All_Hostages_Rescued': ['CT', 'hostages rescued'],
  '#VIP_Escaped': ['CT', 'VIP escaped'],
  '#VIP_Assassinated': ['T', 'VIP killed'],
  '#VIP_Not_Escaped': ['T', 'time ran out'],
  '#CTs_PreventEscape': ['CT', 'other'],
  '#Escaping_Terrorists_Neutralized': ['CT', 'other'],
  '#Terrorists_Escaped': ['T', 'other'],
};

function toTeam(name: string): Team {
  if (name === 'TERRORIST') return 'T';
  if (name === 'CT') return 'CT';
  if (name === 'SPECTATOR') return 'SPECTATOR';
  return 'UNASSIGNED';
}

const round1 = (n: number) => Math.round(n * 100) / 100;

export function extractMatch(demo: DemoFile, options: ExtractOptions = {}): MatchData {
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  const wantTracks = options.tracks === true;
  const wantAim = options.aim === true;
  const aim: AimData = { view: [], shots: [], players: [] };
  const aimPoints = new Map<number, number[]>();
  const sampleStep = 1 / (options.samplesPerSecond ?? 10);
  const tracker = new EntityTracker(s);
  const tracks = new Map<number, PlayerTrack>();
  // Grenades in flight (entity number → the grenade being followed); a gap or another model starts a new one.
  const grenades: Grenade[] = [];
  const liveGrenade = new Map<number, { g: Grenade; last: number }>();
  const lastSample = new Map<number, number>();
  let models: string[] = [];
  let sounds: string[] = [];
  /** A plant whose position is not known yet (CS 1.5 does not send it): filled from the C4 object or its sounds. */
  const pendingPlant = () => {
    const e = [...m.bomb].reverse().find((x) => x.kind === 'planted');
    return e && !e.position ? e : undefined;
  };
  const track = (id: number): PlayerTrack => tracks.get(id) ?? (tracks.set(id, { player: id, seen: [], radar: [], heard: [] }).get(id)!);
  const weaponName = (index: unknown) => {
    const n = typeof index === 'number' ? models[index] : undefined;
    return n ? n.replace(/^models\/p_/i, '').replace(/\.mdl$/i, '') : undefined;
  };
  // Players by server user id; the current occupant of each slot.
  const players = new Map<number, MatchPlayer>();
  const occupant = new Map<number, number>();
  let tempId = -1;
  const playerById = (id: number, slot: number): MatchPlayer => {
    let p = players.get(id);
    if (!p) {
      p = { id, slot, name: '', names: [], isHltv: false, isRecorder: false, shots: {} };
      players.set(id, p);
    }
    return p;
  };
  /** The player now in a slot (created with a temporary id if no user info has been seen yet). */
  const player = (slot: number): MatchPlayer => {
    let id = occupant.get(slot);
    if (id === undefined) {
      id = tempId--;
      occupant.set(slot, id);
    }
    return playerById(id, slot);
  };
  const idOf = (slot: number) => player(slot).id;

  const m: MatchData = {
    map: demo.header.mapName.replace(/\.bsp$/i, ''),
    recording: 'POV',
    restarts: 0,
    players: [],
    rounds: [],
    kills: [],
    deaths: [],
    chat: [],
    radio: [],
    bomb: [],
    voice: [],
    director: [],
    net: { pings: [], choke: [], lost: [] },
  };
  const net: NetData = m.net!;
  const lastPing = new Map<number, number>();
  let lastSeq = -1;
  const rec: RecorderData = { money: [], health: [], damageTaken: [], menus: [], shots: 0, keys: [], weapons: [] };
  const rounds: Round[] = [];
  let cur: Round | undefined;
  let restartAt: number | undefined;
  /** Data kept through later restarts (whole halves); see the restart handling. */
  let kept = { rounds: 0, kills: 0, deaths: 0, bomb: 0 };
  /** Times a kept half ended with a restart (the server resets the scores then). */
  const scoreSegments: number[] = [];
  /** Every ScoreInfo (player id, frags, deaths), to read the scores as they stood at the end of each half. */
  const scoreLog: { time: number; id: number; frags: number; deaths: number }[] = [];
  let eventNames: string[] = [];
  const packet = new Set<number>(); // entity numbers in the current packet (events refer to positions in this list)
  const lastVoice = new Map<number, VoiceBurst>();
  let playback = false;
  let lastTeamScore: { T?: number; CT?: number } = {};

  const roundNo = () => cur?.number;
  const addShot = (slot: number, weapon: string) => {
    const p = player(slot);  // current occupant of the slot
    p.shots[weapon] = (p.shots[weapon] ?? 0) + 1;
  };

  demo.sections.forEach((section, si) => {
    if (si > 0) playback = true;
    for (const f of section.frames) {
      const t = round1(f.time);
      if (!playback) {
        if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      } else if (f.type === FrameType.Event) {
        // The recorder's own weapon events: flags i32, event index i32, ...
        const index = f.payload.length >= 8 ? new DataView(f.payload.buffer, f.payload.byteOffset).getInt32(4, true) : -1;
        rec.shots++;
        if (m.recorderSlot !== undefined && eventNames[index]) addShot(m.recorderSlot, eventNames[index]);
        if (wantAim) aim.shots.push({ time: ms(f.time), weapon: eventNames[index] ?? `event${index}` });
        continue;
      } else if (f.type === FrameType.ConsoleCommand) {
        if (/^[+-]/.test(f.command)) rec.keys.push({ time: t, command: f.command.trim() });
        continue;
      }
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;

      // An announced restart has happened. After a real half (5+ completed rounds since the last kept point: league
      // configs restart the game at half-time) everything is kept; otherwise what came before was warm-up (or a
      // "live on three" restart) and is dropped (2.18).
      if (restartAt !== undefined && (f.time >= restartAt || f.time < restartAt - 60)) {
        restartAt = undefined;
        const done = rounds.slice(kept.rounds).filter((r) => r.winner !== undefined).length;
        if (done >= HALF_ROUNDS) {
          // Keep the half; an unfinished round at the restart is dropped.
          while (rounds.length > kept.rounds && rounds[rounds.length - 1].winner === undefined) rounds.pop();
          kept = { rounds: rounds.length, kills: m.kills.length, deaths: m.deaths.length, bomb: m.bomb.length };
          scoreSegments.push(t);
          cur = undefined;
          lastTeamScore = {};
        } else {
          m.restarts++;
          if (kept.rounds === 0) m.liveStart = t;
          rounds.length = kept.rounds;
          cur = undefined;
          m.kills.length = kept.kills;
          m.deaths.length = kept.deaths;
          m.bomb.length = kept.bomb;
          if (kept.rounds === 0) for (const p of players.values()) p.shots = {};
          lastTeamScore = {};
        }
      }

      // POV: the recorder's own exact position from the frame's view info (simorg), plan 2.16.
      if (wantTracks && playback && m.recording !== 'HLTV' && m.recorderSlot !== undefined) {
        const v = viewInfo(f.info);
        const id = idOf(m.recorderSlot);
        if (v && v.health > 0 && v.viewHeight > 0 && t - (lastSample.get(id) ?? -1) >= sampleStep) {
          lastSample.set(id, t);
          track(id).seen.push({ time: t, x: q8(v.origin[0]), y: q8(v.origin[1]), z: q8(v.origin[2]), yaw: Math.round(((v.yaw % 360) + 360) % 360), alive: true });
        }
      }

      // 5.u the recorder's own view every frame.
      if (wantAim && playback && m.recording !== 'HLTV') {
        const v = viewInfo(f.info);
        if (v) aim.view.push({
          time: ms(f.time), pitch: r2(v.pitch), yaw: r2(v.yaw), eye: [q8(v.eye[0]), q8(v.eye[1]), q8(v.eye[2])],
          speed: Math.round(Math.hypot(v.velocity[0], v.velocity[1]) * 10) / 10, onGround: v.onGround,
          duck: v.viewHeight > 0 && v.viewHeight < 15, attack: (v.buttons & 1) !== 0, alive: v.health > 0 && v.viewHeight > 0,
        });
      }

      // 5.z packets that never arrived: a jump in the incoming packet number (big jumps = a new connection).
      if (playback) {
        const seq = incomingSequence(f.info);
        if (lastSeq >= 0 && seq > lastSeq + 1 && seq - lastSeq <= 100) net.lost.push({ time: t, packets: seq - lastSeq - 1 });
        if (seq > lastSeq || lastSeq - seq > 1000) lastSeq = seq;
      }

      const pendingEvents: EventsBody['events'] = [];
      for (const msg of decodeMessages(f.messages, s)) {
        const b = msg.body;
        if (msg.id === Svc.Choke && playback) net.choke.push(t);
        if (!b) continue;
        switch (b.kind) {
          case 'pings':
            if (!playback) break;
            for (const p of b.pings) {
              if (p.ping >= 999) continue;
              const id = idOf(p.slot);
              if (t - (lastPing.get(id) ?? -Infinity) < 1) continue;
              lastPing.set(id, t);
              net.pings.push({ time: t, player: id, ping: p.ping, loss: p.loss });
            }
            break;
          case 'serverInfo':
            m.recorderSlot = b.playerSlot;
            m.map = b.mapName.replace(/^maps[\\/]/i, '').replace(/\.bsp$/i, '');
            break;
          case 'hltv':
            m.recording = 'HLTV';
            break;
          case 'resourceList':
            models = [];
            sounds = [];
            for (const r of b.resources) {
              if (r.type === 2) models[r.index] = r.name;
              if (r.type === 0) sounds[r.index] = r.name;
            }
            eventNames = [];
            for (const r of b.resources) if (r.type === 5) eventNames[r.index] = r.name.replace(/^events\//i, '').replace(/\.sc$/i, '');
            break;
          case 'userInfo': {
            if (b.info.name === undefined) {
              // Empty user info: the player left; the slot is free.
              const gone = occupant.get(b.slot);
              if (gone !== undefined && players.has(gone)) players.get(gone)!.leftAt = round1(f.time);
              occupant.delete(b.slot);
              break;
            }
            const prevId = occupant.get(b.slot);
            if (prevId !== undefined && prevId < 0 && !players.has(b.userId)) {
              // Replace a temporary id with the real one.
              const tmp = players.get(prevId);
              players.delete(prevId);
              if (tmp) players.set(b.userId, { ...tmp, id: b.userId });
            }
            if (prevId !== undefined && prevId >= 0 && prevId !== b.userId) {
              // A new connection took the slot (e.g. a reconnect): the previous player left.
              const old = players.get(prevId);
              if (old && old.leftAt === undefined) old.leftAt = round1(f.time);
            }
            occupant.set(b.slot, b.userId);
            const p = playerById(b.userId, b.slot);
            p.slot = b.slot;
            const name = b.info.name;
            if (name !== undefined && name !== p.name) {
              p.name = name;
              if (p.names[p.names.length - 1] !== name) p.names.push(name);
            }
            if (b.info['*hltv'] !== undefined) p.isHltv = true;
            p.userinfo = { ...b.info };
            break;
          }
          case 'director':
            if (playback) {
              const dv = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength);
              // Type 2 (event): entity1 u16, entity2 u16, flags u32 (priority = low 4 bits; HL SDK hltv.h).
              m.director.push(b.data[0] === 2 && b.data.length >= 9
                ? { time: t, type: 2, entity1: dv.getUint16(1, true), entity2: dv.getUint16(3, true), flags: dv.getUint32(5, true) }
                : { time: t, type: b.data[0] });
            }
            break;
          case 'voiceData': {
            if (!playback || b.data.length === 0) break;
            const last = lastVoice.get(b.slot);
            const pid = idOf(b.slot);
            if (last && last.player === pid && t >= last.end && t - last.end <= BURST_GAP) {
              last.end = t;
              last.packets++;
            } else {
              const burst: VoiceBurst = { player: pid, slot: b.slot, start: t, end: t, packets: 1 };
              m.voice.push(burst);
              lastVoice.set(b.slot, burst);
            }
            break;
          }
          case 'events':
            if (playback) pendingEvents.push(...b.events);
            break;
          case 'entities': {
            const states = tracker.packet(b, incomingSequence(f.info));
            packet.clear();
            for (const n of states.keys()) packet.add(n);
            const plant = pendingPlant();
            if (plant && t - plant.time >= 0 && t - plant.time < 30) {
              for (const [n, es] of states) {
                if (n <= 32 || typeof es.modelindex !== 'number' || !/w_c4\.mdl$/i.test(models[es.modelindex] ?? '')) continue;
                if (typeof es['origin[0]'] !== 'number') continue;
                plant.position = [es['origin[0]'] as number, es['origin[1]'] as number, es['origin[2]'] as number];
                break;
              }
            }
            if ((wantTracks || wantAim) && playback) {
              for (const [n, es] of states) {
                if (n <= 32 || typeof es.modelindex !== 'number' || typeof es['origin[0]'] !== 'number') continue;
                const kind = grenadeKind(models[es.modelindex]);
                if (!kind) continue;
                const pt = { time: t, x: q8(es['origin[0]'] as number), y: q8(es['origin[1]'] as number), z: q8(es['origin[2]'] as number) };
                const cur = liveGrenade.get(n);
                if (cur && cur.g.kind === kind && t - cur.last < 1) {
                  const prev = cur.g.points[cur.g.points.length - 1];
                  // In flight about 10 points a second; lying still (a smoke grenade) one a second.
                  const moved = Math.hypot(pt.x - prev.x, pt.y - prev.y, pt.z - prev.z) > 2;
                  if ((moved && t - prev.time >= 0.1) || t - prev.time >= 1) cur.g.points.push(pt);
                  cur.last = t;
                } else {
                  const g: Grenade = { kind, points: [pt] };
                  grenades.push(g);
                  liveGrenade.set(n, { g, last: t });
                }
              }
              for (const [n, es] of states) {
                if (n < 1 || n > 32 || typeof es['origin[0]'] !== 'number' || typeof es['origin[1]'] !== 'number' || typeof es['origin[2]'] !== 'number') continue;
                const id = idOf(n - 1);
                if (wantAim) {
                  const list = aimPoints.get(id) ?? (aimPoints.set(id, []).get(id)!);
                  list.push(ms(f.time), q8(es['origin[0]'] as number), q8(es['origin[1]'] as number), q8(es['origin[2]'] as number), es.usehull === 1 ? 1 : 0);
                }
                if (t - (lastSample.get(id) ?? -1) < sampleStep) continue;
                lastSample.set(id, t);
                const yaw = es['angles[1]'];
                track(id).seen.push({
                  time: t, x: q8(es['origin[0]'] as number), y: q8(es['origin[1]'] as number), z: q8(es['origin[2]'] as number),
                  yaw: typeof yaw === 'number' ? Math.round(yaw) : undefined, weapon: weaponName(es['weaponmodel']), alive: true,
                  ...(es.usehull === 1 ? { crouch: true } : {}),
                });
              }
            }
            break;
          }
          case 'baseline':
            tracker.baseline(b);
            break;
          case 'sound': {
            const plant = pendingPlant();
            const name = sounds[b.sound] ?? '';
            if (plant && /weapons\/c4_(plant|beep)/i.test(name) && t - plant.time >= -1 && t - plant.time < 45 && b.origin.every((v) => v !== undefined)) {
              plant.position = [b.origin[0]!, b.origin[1]!, b.origin[2]!];
            }
            if (wantTracks && playback && b.entity >= 1 && b.entity <= 32 && b.origin[0] !== undefined && b.origin[1] !== undefined) {
              track(idOf(b.entity - 1)).heard.push({
                time: t, x: q8(b.origin[0]), y: q8(b.origin[1]), z: q8(b.origin[2] ?? 0), alive: true,
                sound: (sounds[b.sound] ?? `sound${b.sound}`).replace(/\.wav$/i, ''),
              });
            }
            break;
          }
          case 'user':
            handleUser(b.name, new PayloadReader(b.payload), t, f.time);
            break;
        }
      }
      if (pendingEvents.length) {
        const list = [...packet].sort((a, b) => a - b);
        const evd = s.deltas.get('event_t');
        for (const e of pendingEvents) {
          const ent = (e.record && evd?.getInteger(e.record, 'entindex')) || (e.entity !== undefined ? list[e.entity] : undefined);
          if (ent === undefined || ent < 1 || ent > 32) continue;
          addShot(ent - 1, eventNames[e.index] ?? `event${e.index}`);
        }
      }
    }
  });

  function handleUser(name: string, p: PayloadReader, t: number, rawTime: number): void {
    switch (name) {
      case 'TeamInfo': {
        const slot = p.u8() - 1;
        player(slot).team = toTeam(p.str());
        break;
      }
      case 'RoundTime': {
        const sec = p.i16();
        // A round starts with the freeze-time value (short); the round-length value (long) ends freeze time.
        // With no freeze time only the long value comes.
        if (!cur || cur.end !== undefined || (sec <= MAX_FREEZE_SECONDS && cur.freezeEnd !== undefined)) {
          cur = { number: rounds.length + 1, start: t };
          rounds.push(cur);
        }
        if (sec > MAX_FREEZE_SECONDS && cur.freezeEnd === undefined) cur.freezeEnd = t;
        break;
      }
      case 'DeathMsg': {
        const killer = p.u8(), victim = p.u8(), headshot = p.u8() === 1, weapon = p.str();
        const kp = killer === 0 ? null : player(killer - 1);
        const vp = player(victim - 1);
        const kt = kp?.team;
        const vt = vp.team;
        const suicide = kp !== null && kp.id === vp.id;
        m.kills.push({
          time: t, round: roundNo(), killer: kp ? kp.id : null, victim: vp.id, headshot, weapon,
          killerTeam: kt, victimTeam: vt, suicide, teamKill: !suicide && kt !== undefined && kt === vt,
        });
        break;
      }
      case 'ClCorpse': {
        // CS 1.5: model, origin as i32/128, angles, delay, sequence, body. No player number: match to kills in order.
        const model = p.str();
        const position: [number, number, number] = [p.i32() / 128, p.i32() / 128, p.i32() / 128];
        m.deaths.push({ time: t, round: roundNo(), model, position });
        break;
      }
      case 'TextMsg': {
        p.u8();
        const text = p.str();
        const end = ROUND_END[text];
        if (end && cur && cur.end === undefined) {
          cur.end = t;
          [cur.winner, cur.reason] = end;
        } else if (end && cur && cur.reason === 'eliminated') {
          cur.reason = end[1];
        }
        if (text === '#Game_will_restart_in') restartAt = rawTime + Number(p.str() || 1);
        if (text === '#Game_Commencing') restartAt = rawTime + 3;
        if (text === '#Bomb_Planted') {
          // The plant position may already have arrived as a bomb drop just before this message.
          const lastDrop = [...m.bomb].reverse().find((e) => e.kind === 'dropped');
          if (lastDrop && Math.abs(lastDrop.time - t) <= 2) {
            lastDrop.kind = 'planted';
            lastDrop.time = t;
          } else addBomb({ time: t, kind: 'planted' });
        }
        if (text === '#Bomb_Defused') addBomb({ time: t, kind: 'defused' });
        if (text === '#Target_Bombed') addBomb({ time: t, kind: 'exploded' });
        if (text === '#Defusing_Bomb_With_Defuse_Kit' || text === '#Defusing_Bomb_Without_Defuse_Kit') addBomb({ time: t, kind: 'defusing' });
        break;
      }
      case 'BombDrop': {
        // CS 1.5: x, y, z only (6 bytes). CS 1.6 adds a flag byte (1 = planted). A drop sent together with the
        // "#Bomb_Planted" message (within 2 s) is the plant position.
        const position: [number, number, number] = [p.coord(), p.coord(), p.coord()];
        const flag = p.remaining > 0 ? p.u8() : undefined;
        const lastPlant = [...m.bomb].reverse().find((e) => e.kind === 'planted');
        const nearPlant = lastPlant && !lastPlant.position && Math.abs(lastPlant.time - t) <= 2;
        if (flag === 1 || nearPlant) {
          if (nearPlant) lastPlant!.position = position;
          else addBomb({ time: t, kind: 'planted', position });
        } else addBomb({ time: t, kind: 'dropped', position });
        break;
      }
      case 'BombPickup':
        addBomb({ time: t, kind: 'picked up' });
        break;
      case 'SayText': {
        const senderEntity = p.u8();
        const sender = senderEntity >= 1 && senderEntity <= 32 ? idOf(senderEntity - 1) : undefined;
        const raw = p.str();
        const text = raw.replace(/[\x01-\x04]/g, '').replace(/\s+$/, '');
        m.chat.push({
          time: t, round: roundNo(), sender, text,
          teamOnly: /^(\*DEAD\*\s*)?\((Counter-Terrorist|Terrorist|Spectator)\)/.test(text),
          dead: /\*DEAD\*/.test(text),
        });
        break;
      }
      case 'SendAudio': {
        const senderEntity = p.u8();
        const sender = senderEntity >= 1 && senderEntity <= 32 ? idOf(senderEntity - 1) : undefined;
        const sound = p.str();
        m.radio.push({ time: t, round: roundNo(), sender, message: sound.replace(/^%!MRAD_/, '') });
        break;
      }
      case 'TeamScore': {
        const team = toTeam(p.str());
        const score = p.i16();
        if (team === 'T') lastTeamScore.T = score;
        if (team === 'CT') lastTeamScore.CT = score;
        if (cur) {
          if (lastTeamScore.T !== undefined) cur.scoreT = lastTeamScore.T;
          if (lastTeamScore.CT !== undefined) cur.scoreCT = lastTeamScore.CT;
        }
        break;
      }
      case 'Radar': {
        // Teammate positions sent to the recorder (POV): entity, x, y, z.
        const slot = p.u8() - 1;
        const x = p.coord(), y = p.coord(), z = p.coord();
        if (wantTracks && playback && slot >= 0 && slot < 32) track(idOf(slot)).radar.push({ time: t, x: q8(x), y: q8(y), z: q8(z), alive: true });
        break;
      }
      case 'ScoreInfo': {
        const pl = player(p.u8() - 1);
        pl.frags = p.i16();
        pl.deaths = p.i16();
        scoreLog.push({ time: t, id: pl.id, frags: pl.frags, deaths: pl.deaths });
        break;
      }
      // Recorder-only messages (POV demos).
      case 'Money':
        if (playback) rec.money.push({ time: t, money: p.i32() });
        break;
      case 'Health':
        if (playback) rec.health.push({ time: t, health: p.u8() });
        break;
      case 'Damage': {
        p.u8();
        const amount = p.u8();
        p.i32();
        const from: [number, number, number] = [p.coord(), p.coord(), p.coord()];
        if (playback && amount > 0) rec.damageTaken.push({ time: t, amount, from });
        break;
      }
      case 'CurWeapon': {
        // state (1 = the weapon in hand), weapon id (CS weapon numbers), ammo in the clip.
        const state = p.u8(), id = p.i8();
        const weapon = CS_WEAPON_IDS[id];
        if (playback && state === 1 && weapon && rec.weapons.at(-1)?.weapon !== weapon) rec.weapons.push({ time: t, weapon });
        break;
      }
      case 'ShowMenu': {
        p.i16();
        p.i8();
        p.u8();
        const menu = p.str();
        if (playback && menu) rec.menus.push({ time: t, menu });
        break;
      }
    }
  }

  function addBomb(e: BombEvent): void {
    e.round = roundNo();
    m.bomb.push(e);
  }

  // Kills before a player's first TeamInfo (recording started mid-match): use the team seen later (fixed per half).
  for (const k of m.kills) {
    if (k.victimTeam === undefined) k.victimTeam = players.get(k.victim)?.team;
    if (k.killer !== null && k.killerTeam === undefined) k.killerTeam = players.get(k.killer)?.team;
    if (k.killer !== null && !k.suicide) k.teamKill = k.killerTeam !== undefined && k.killerTeam === k.victimTeam;
  }
  matchDeaths(m);
  if (wantTracks) {
    // Mark points after the player's death in a round as not alive (bodies and death sounds can still appear).
    const deathsOf = new Map<number, number[]>();
    for (const k of m.kills) (deathsOf.get(k.victim) ?? deathsOf.set(k.victim, []).get(k.victim)!).push(k.time);
    const roundStarts = rounds.map((r) => r.start).sort((a, b) => a - b);
    const nextStart = (t: number) => roundStarts.find((x) => x > t) ?? Infinity;
    for (const tr of tracks.values()) {
      const deaths = deathsOf.get(tr.player) ?? [];
      const dead = (t: number) => deaths.some((d) => d <= t && t < nextStart(d));
      for (const list of [tr.seen, tr.radar, tr.heard] as TrackPoint[][]) for (const pt of list) pt.alive = !dead(pt.time);
    }
    m.grenades = grenades.filter((g) => (m.liveStart === undefined || g.points[0].time >= m.liveStart));
    m.tracks = [...tracks.values()].filter((tr) => players.get(tr.player)?.name).sort((a, b) => a.player - b.player);
  }
  if (s.hltv) m.recording = 'HLTV';
  if (wantAim && m.recording === 'POV') {
    aim.players = [...aimPoints].filter(([id]) => players.get(id)?.name).map(([player, points]) => ({ player, points })).sort((a, b) => a.player - b.player);
    m.aim = aim;
  }
  // Chat and radio from before the match started belong to no round (round numbers restart at 1 after a restart).
  if (m.liveStart !== undefined) for (const x of [...m.chat, ...m.radio]) if (x.time < m.liveStart) x.round = undefined;
  m.rounds = rounds.filter((r) => r.winner !== undefined);
  // Final scores as the server had them at the end of each kept part (a recording often runs on after the last round,
  // into a restart that resets everyone to 0): per part, the last ScoreInfo up to 6 s after its last round, added up.
  if (m.rounds.length && scoreLog.length) {
    const bounds = [...scoreSegments, Infinity];
    const finals = new Map<number, { frags: number; deaths: number }>();
    let from = -Infinity;
    for (const until of bounds) {
      const last = [...m.rounds].reverse().find((r) => r.end !== undefined && r.end >= from && r.end < until);
      if (last) {
        const limit = Math.min(last.end! + 6, until);
        const latest = new Map<number, { frags: number; deaths: number }>();
        const reset = new Set<number>();
        for (const e of scoreLog) {
          if (e.time < from || e.time > limit || reset.has(e.id)) continue;
          // A drop to 0 : 0 in the last round (the server resetting for the next half) ends this part for him.
          const prev = latest.get(e.id);
          if (prev && e.frags === 0 && e.deaths === 0 && prev.frags + prev.deaths >= 3 && e.time >= last.start) { reset.add(e.id); continue; }
          latest.set(e.id, e);
        }
        for (const [id, e] of latest) { const f = finals.get(id) ?? { frags: 0, deaths: 0 }; finals.set(id, { frags: f.frags + e.frags, deaths: f.deaths + e.deaths }); }
      }
      from = until;
    }
    for (const [id, f] of finals) { const pl = players.get(id); if (pl) { pl.frags = f.frags; pl.deaths = f.deaths; } }
  }
  // CS 1.6 gives 3 points for a bomb that explodes (the planter) or is defused (the defuser): a jump of exactly 3 in a
  // player's score within 6 s of that moment (it shows when the next round starts), with no kill of his then, is counted (2.18).
  for (const b of m.bomb) {
    if (b.kind !== 'exploded' && b.kind !== 'defused') continue;
    const before = new Map<number, number>();
    for (const e of scoreLog) {
      if (e.time < b.time - 1) { before.set(e.id, e.frags); continue; }
      if (e.time > b.time + 6) break;
      const was = before.get(e.id);
      if (was !== undefined && e.frags - was === 3 && !m.kills.some((k) => k.killer === e.id && Math.abs(k.time - b.time) <= 3)) {
        const pl = players.get(e.id);
        if (pl) pl.bonusFrags = (pl.bonusFrags ?? 0) + 3;
        before.set(e.id, e.frags);
        break;
      }
      before.set(e.id, e.frags);
    }
  }
  // The server's team score, added up over the kept halves (it starts again at 0 after a half-time restart).
  {
    let from = -Infinity, any = false, T = 0, CT = 0;
    for (const until of [...scoreSegments, Infinity]) {
      const lastScored = [...m.rounds].reverse().find((r) => r.start >= from && r.start < until && (r.scoreT !== undefined || r.scoreCT !== undefined));
      if (lastScored) { any = true; T += lastScored.scoreT ?? 0; CT += lastScored.scoreCT ?? 0; }
      from = until;
    }
    m.scoreT = any ? T : undefined;
    m.scoreCT = any ? CT : undefined;
  }
  if (m.recording === 'POV' && m.recorderSlot !== undefined) {
    const r = player(m.recorderSlot);
    r.isRecorder = true;
    m.recorderId = r.id;
    m.recorder = rec;
  } else {
    m.recorderSlot = undefined;
  }
  m.players = [...players.values()].filter((p) => p.name !== '').sort((a, b) => a.slot - b.slot || a.id - b.id);
  return m;
}

const T_MODELS = new Set(['terror', 'leet', 'arctic', 'guerilla']);
const CT_MODELS = new Set(['urban', 'gsg9', 'sas', 'gign', 'vip']);
/** Corpses usually arrive this long after the kill (the death cam ends and the player becomes a spectator). */
const CORPSE_DELAY = { min: 3, max: 7.5 };

/** Gives each corpse its victim (see Death.victim). */
function matchDeaths(m: MatchData): void {
  const used = new Set<Kill>();
  const teamOfModel = (model: string) => (T_MODELS.has(model) ? 'T' : CT_MODELS.has(model) ? 'CT' : undefined);
  for (const d of m.deaths) {
    const team = teamOfModel(d.model);
    const fits = (k: Kill) => !used.has(k) && (team === undefined || k.victimTeam === undefined || k.victimTeam === team) && k.time <= d.time;
    let kill = m.kills.find((k) => fits(k) && d.time - k.time >= CORPSE_DELAY.min && d.time - k.time <= CORPSE_DELAY.max);
    let how: Death['match'] = 'timing';
    if (!kill) {
      kill = m.kills.find((k) => fits(k) && k.round === d.round);
      how = 'round';
    }
    if (kill) {
      used.add(kill);
      d.victim = kill.victim;
      d.match = how;
    }
  }
}

/** Checks the extracted data against the server's own numbers (final frags and team score). */
export function checkMatch(m: MatchData): MatchCheck {
  const counted = new Map<number, number>();
  for (const k of m.kills) {
    if (k.killer === null) continue;
    counted.set(k.killer, (counted.get(k.killer) ?? 0) + (k.suicide || k.teamKill ? -1 : 1));
  }
  for (const p of m.players) if (p.bonusFrags) counted.set(p.id, (counted.get(p.id) ?? 0) + p.bonusFrags);
  // Players who left before the match went live keep their warm-up score (the restart never reset it): skip them.
  const leftBeforeLive = (p: MatchPlayer) => p.leftAt !== undefined && m.liveStart !== undefined && p.leftAt < m.liveStart;
  const fragMismatches = m.players
    .filter((p) => p.frags !== undefined && !leftBeforeLive(p) && (counted.get(p.id) ?? 0) !== p.frags)
    .map((p) => ({ player: p.id, name: p.name, counted: counted.get(p.id) ?? 0, server: p.frags! }));
  const roundsWon = { T: m.rounds.filter((r) => r.winner === 'T').length, CT: m.rounds.filter((r) => r.winner === 'CT').length };
  const serverScore = m.scoreT !== undefined || m.scoreCT !== undefined ? { T: m.scoreT ?? 0, CT: m.scoreCT ?? 0 } : undefined;
  return {
    fragsMatch: fragMismatches.length === 0,
    fragMismatches,
    roundsMatch: !!serverScore && serverScore.T === roundsWon.T && serverScore.CT === roundsWon.CT,
    roundsWon,
    serverScore,
  };
}

/** Positions keep the demo's own precision (1/8 unit). */
const q8 = (v: number) => Math.round(v * 8) / 8;
const ms = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The recorder's view info at the start of a network frame (protocol 44+; checked on Set 1 POV demos 2026-10-26 and,
 * for 5.u, 2026-10-31): timestamp f32 at 0, then ref_params: vieworg (eye) at 4, viewangles at 16 (pitch 16, yaw 20;
 * pitch + = looking down), onground i32 at 84, simvel at 92, simorg (origin) at 104, viewheight z at 124 (17 standing,
 * 12 crouching, 0 dead), health i32 at 144; then the user command at 236 (buttons u16 at 266: 1 = fire, 8 = forward,
 * 512 = move left — matched against +attack/+moveleft console frames). Protocol 43 (560-byte info): the same up to
 * byte 212, but its user command starts at 212, so buttons are at 242 (Old CS Lab demos, 2026-11-01).
 */
export function viewInfo(info: Uint8Array): { origin: [number, number, number]; eye: [number, number, number]; velocity: [number, number, number]; onGround: boolean; viewHeight: number; health: number; pitch: number; yaw: number; buttons: number } | undefined {
  if (info.length < 268) return undefined;
  const v = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const f = (o: number) => v.getFloat32(o, true);
  return {
    origin: [f(104), f(108), f(112)], eye: [f(4), f(8), f(12)], velocity: [f(92), f(96), f(100)],
    onGround: v.getInt32(84, true) !== 0, viewHeight: f(124), health: v.getInt32(144, true), pitch: f(16), yaw: f(20), buttons: v.getUint16(info.length === 560 ? 242 : 266, true),
  };
}

/** Grenade kind from a world model name (models/w_hegrenade.mdl, w_flashbang.mdl, w_smokegrenade.mdl). */
function grenadeKind(model: string | undefined): Grenade['kind'] | undefined {
  if (!model) return undefined;
  if (/w_hegrenade\.mdl$/i.test(model)) return 'he';
  if (/w_flashbang\.mdl$/i.test(model)) return 'flash';
  if (/w_smokegrenade\.mdl$/i.test(model)) return 'smoke';
  return undefined;
}

/** CS weapon numbers (CSW_* in the CS game code: CurWeapon, WeapPickup), as world-model names. 14/15 = galil/famas (1.6). */
const CS_WEAPON_IDS: Record<number, string> = {
  1: 'p228', 3: 'scout', 4: 'hegrenade', 5: 'xm1014', 6: 'c4', 7: 'mac10', 8: 'aug', 9: 'smokegrenade', 10: 'elite',
  11: 'fiveseven', 12: 'ump45', 13: 'sg550', 14: 'galil', 15: 'famas', 16: 'usp', 17: 'glock18', 18: 'awp',
  19: 'mp5navy', 20: 'm249', 21: 'm3', 22: 'm4a1', 23: 'tmp', 24: 'g3sg1', 25: 'flashbang', 26: 'deagle', 27: 'sg552',
  28: 'ak47', 29: 'knife', 30: 'p90',
};
