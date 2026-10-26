// Extracts match information from a demo in one pass (plan 2.12). Layouts and their evidence: docs/FORMAT.md.
// Data from before the last match restart (warm-up, "restart in 3 seconds") is dropped from rounds, kills, deaths,
// bomb events and shots; chat, radio and voice are kept for the whole demo (with `round` undefined before the match).
import { FrameType, type DemoFile } from '../container/types.js';
import { createState, decodeMessages, type EventsBody } from '../protocol/messages.js';
import { PayloadReader } from './payload.js';
import type { BombEvent, ChatLine, Death, Kill, MatchCheck, MatchData, MatchPlayer, RecorderData, Round, RoundEndReason, Team, VoiceBurst } from './types.js';

/** Voice packets further apart than this start a new talk burst. */
const BURST_GAP = 0.3;
/** RoundTime values up to this many seconds are freeze time (a new round); longer values are the round length. */
const MAX_FREEZE_SECONDS = 15;

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

export function extractMatch(demo: DemoFile): MatchData {
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
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
  };
  const rec: RecorderData = { money: [], health: [], damageTaken: [], menus: [], shots: 0, keys: [] };
  const rounds: Round[] = [];
  let cur: Round | undefined;
  let restartAt: number | undefined;
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
        continue;
      } else if (f.type === FrameType.ConsoleCommand) {
        if (/^[+-]/.test(f.command)) rec.keys.push({ time: t, command: f.command.trim() });
        continue;
      }
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;

      // An announced restart has happened: everything before was warm-up.
      if (restartAt !== undefined && (f.time >= restartAt || f.time < restartAt - 60)) {
        restartAt = undefined;
        m.restarts++;
        m.liveStart = t;
        rounds.length = 0;
        cur = undefined;
        m.kills.length = 0;
        m.deaths.length = 0;
        m.bomb.length = 0;
        for (const p of players.values()) p.shots = {};
        lastTeamScore = {};
      }

      const pendingEvents: EventsBody['events'] = [];
      for (const msg of decodeMessages(f.messages, s)) {
        const b = msg.body;
        if (!b) continue;
        switch (b.kind) {
          case 'serverInfo':
            m.recorderSlot = b.playerSlot;
            m.map = b.mapName.replace(/^maps[\\/]/i, '').replace(/\.bsp$/i, '');
            break;
          case 'hltv':
            m.recording = 'HLTV';
            break;
          case 'resourceList':
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
            break;
          }
          case 'director':
            if (playback) m.director.push({ time: t, type: b.data[0] });
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
          case 'entities':
            if (!b.isDelta) packet.clear();
            for (const e of b.entities) (e.remove ? packet.delete(e.number) : packet.add(e.number));
            break;
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
        if (text === '#Bomb_Planted') addBomb({ time: t, kind: 'planted' });
        if (text === '#Bomb_Defused') addBomb({ time: t, kind: 'defused' });
        if (text === '#Target_Bombed') addBomb({ time: t, kind: 'exploded' });
        if (text === '#Defusing_Bomb_With_Defuse_Kit' || text === '#Defusing_Bomb_Without_Defuse_Kit') addBomb({ time: t, kind: 'defusing' });
        break;
      }
      case 'BombDrop': {
        const position: [number, number, number] = [p.coord(), p.coord(), p.coord()];
        const planted = p.u8() === 1;
        if (planted) {
          const last = [...m.bomb].reverse().find((e) => e.kind === 'planted');
          if (last && !last.position && Math.abs(last.time - t) < 3) last.position = position;
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
      case 'ScoreInfo': {
        const pl = player(p.u8() - 1);
        pl.frags = p.i16();
        pl.deaths = p.i16();
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
  if (s.hltv) m.recording = 'HLTV';
  // Chat and radio from before the match started belong to no round (round numbers restart at 1 after a restart).
  if (m.liveStart !== undefined) for (const x of [...m.chat, ...m.radio]) if (x.time < m.liveStart) x.round = undefined;
  m.rounds = rounds.filter((r) => r.winner !== undefined);
  const lastScored = [...m.rounds].reverse().find((r) => r.scoreT !== undefined || r.scoreCT !== undefined);
  m.scoreT = lastScored?.scoreT;
  m.scoreCT = lastScored?.scoreCT;
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
