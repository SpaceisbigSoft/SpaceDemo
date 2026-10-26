// Development tool (plan 1.8): extract match information from demos to see what the app can show.
//   npx tsx tools/dev/match-data.ts <demo.dem | folder>... --out <folder>
// Writes one JSON per demo (rounds, kills, chat, radio, bomb, scoreboard, positions, shots, recorder data)
// and prints a one-line summary per demo. Message layouts: docs/FORMAT.md (CS 1.5 game messages).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args.splice(oi, 2)[1] : 'match-data';
mkdirSync(outDir, { recursive: true });
const files: string[] = [];
const collect = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) collect(join(p, e));
  else if (extname(p).toLowerCase() === '.dem') files.push(p);
};
for (const a of args) collect(a);

/** Little reader for game-message payloads. */
class P {
  o = 0;
  constructor(readonly b: Uint8Array) {}
  get left() { return this.b.length - this.o; }
  u8() { return this.b[this.o++]; }
  i8() { const v = this.b[this.o++]; return v > 127 ? v - 256 : v; }
  i16() { const v = this.b[this.o] | (this.b[this.o + 1] << 8); this.o += 2; return v > 32767 ? v - 65536 : v; }
  i32() { const v = this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16) | (this.b[this.o + 3] << 24); this.o += 4; return v; }
  coord() { return this.i16() / 8; }
  str() { let s = ''; while (this.o < this.b.length) { const c = this.b[this.o++]; if (c === 0) break; s += String.fromCharCode(c); } return s; }
}

const r1 = (n: number) => Math.round(n * 10) / 10;

for (const path of files) {
  const name = basename(path);
  const demo = readDemo(new Uint8Array(readFileSync(path)));
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);

  const names = new Map<number, string>(); // slot (0-based) -> name
  const teams = new Map<number, string>(); // slot -> team
  const nameOf = (entity: number) => (entity === 0 ? 'world' : names.get(entity - 1) ?? `#${entity}`);
  let eventNames: string[] = [];

  type Round = { n: number; start: number; freezeEnd?: number; end?: number; winner?: string; reason?: string; kills: number; score?: Record<string, number> };
  const rounds: Round[] = [];
  let cur: Round | undefined;
  let restartAt: number | undefined; // time a announced restart happens
  let restarts = 0;
  const newRound = (t: number) => {
    cur = { n: rounds.length + 1, start: r1(t), kills: 0 }; rounds.push(cur);
  };

  const kills: { t: number; round?: number; killer: string; victim: string; headshot: boolean; weapon: string; killerTeam?: string; victimTeam?: string }[] = [];
  const chat: { t: number; text: string }[] = [];
  const radio: { t: number; who: string; sound: string }[] = [];
  const textMsgs: Record<string, number> = {};
  const bomb: { t: number; what: string; where?: number[]; who?: string }[] = [];
  const corpses: { t: number; player: string; at: number[] }[] = [];
  const scoreboard = new Map<number, { frags: number; deaths: number; team: number }>();
  const teamScore: Record<string, number> = {};
  const shots: Record<string, Record<string, number>> = {};
  const director: Record<string, number> = {};
  const recorder = { money: [] as number[], healthMin: 100, damageTaken: 0, damageEvents: 0, buys: [] as string[], pickups: [] as string[], menus: {} as Record<string, number> };
  // Positions: per player entity, how many network frames the player was present in the entity list, and a sampled track.
  const present = new Map<number, number[]>(); // entity -> origin [x,y,z]
  const coverage = new Map<number, number>();
  const tracks = new Map<number, number[][]>();
  let netFrames = 0;
  // All entity numbers in the current packet (events refer to entities by their position in this list).
  const packetEntities = new Set<number>();
  let localShots = 0;
  let lastTrackT = -1;
  let playback = false;

  for (const [si, section] of demo.sections.entries()) {
    if (si > 0) playback = true;
    for (const f of section.frames) {
      if (f.type === FrameType.Event && playback) localShots++;
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      const t = f.time;
      if (restartAt !== undefined && (t >= restartAt || t < restartAt - 60)) {
        // The match (re)started: everything before was warm-up.
        restartAt = undefined; restarts++;
        rounds.length = 0; kills.length = 0; corpses.length = 0; cur = undefined;
        for (const k of Object.keys(shots)) delete shots[k];
        for (const k of Object.keys(teamScore)) delete teamScore[k];
      }
      if (playback) netFrames++;
      const pendingEvents: { index: number; entity?: number; record?: import('../../engine/src/protocol/delta.js').DeltaRecord }[] = [];
      for (const m of decodeMessages(f.messages, s)) {
        const b = m.body;
        if (!b) continue;
        if (b.kind === 'resourceList') eventNames = []; // rebuilt below
        if (b.kind === 'resourceList') for (const res of b.resources) if (res.type === 5) eventNames[res.index] = res.name.replace(/^events\//, '').replace(/\.sc$/, '');
        if (b.kind === 'userInfo' && b.info.name !== undefined) names.set(b.slot, b.info.name);
        if (b.kind === 'director') director[b.data[0]] = (director[b.data[0]] ?? 0) + 1;
        if (b.kind === 'events' && playback) {
          // Resolved after this frame's entity list is known.
          pendingEvents.push(...b.events);
        }
        if (b.kind === 'entities') {
          if (!b.isDelta) packetEntities.clear();
          for (const e of b.entities) e.remove ? packetEntities.delete(e.number) : packetEntities.add(e.number);
        }
        if (false as boolean) {
          for (const e of [] as { entity?: number; index: number }[]) {
            if (e.entity === undefined || e.entity < 1 || e.entity > 32) continue;
            const who = nameOf(e.entity);
            const what = eventNames[e.index] ?? `event${e.index}`;
            (shots[who] ??= {})[what] = (shots[who][what] ?? 0) + 1;
          }
        }
        if (b.kind === 'entities' && playback) {
          for (const e of b.entities) {
            if (e.number < 1 || e.number > 32) continue;
            if (e.remove) { present.delete(e.number); continue; }
            const d = s.deltas.get(e.descriptor)!;
            const prev = present.get(e.number) ?? [NaN, NaN, NaN];
            const o = [0, 1, 2].map((i) => d.getFloat(e.record!, `origin[${i}]`) ?? prev[i]);
            present.set(e.number, o);
          }
          if (!b.isDelta) for (const k of [...present.keys()]) if (!b.entities.some((e) => e.number === k)) present.delete(k);
          for (const [k, o] of present) {
            coverage.set(k, (coverage.get(k) ?? 0) + 1);
            if (t - lastTrackT >= 1 && !Number.isNaN(o[0])) (tracks.get(k) ?? tracks.set(k, []).get(k)!).push([r1(t), Math.round(o[0]), Math.round(o[1]), Math.round(o[2])]);
          }
          if (t - lastTrackT >= 1) lastTrackT = t;
        }
        if (b.kind !== 'user') continue;
        const p = new P(b.payload);
        switch (b.name) {
          case 'TeamInfo': { const id = p.u8(); teams.set(id - 1, p.str()); break; }
          case 'RoundTime': {
            const sec = p.i16();
            // Freeze time starts a round; the longer value marks the end of freeze time.
            // A round starts with the freeze-time value (short); the round-length value (long) ends freeze time.
            // With no freeze time only the long value comes.
            if (!cur || cur.end !== undefined || (sec <= 15 && cur.freezeEnd !== undefined)) newRound(t);
            if (sec > 15 && cur && cur.freezeEnd === undefined) cur.freezeEnd = r1(t);
            break;
          }
          case 'DeathMsg': {
            const killer = p.u8(), victim = p.u8(), hs = p.u8(), weapon = p.str();
            kills.push({ t: r1(t), round: cur?.n, killer: nameOf(killer), victim: nameOf(victim), headshot: hs === 1, weapon, killerTeam: teams.get(killer - 1), victimTeam: teams.get(victim - 1) });
            if (cur) cur.kills++;
            break;
          }
          case 'TextMsg': {
            p.u8();
            const msg = p.str();
            textMsgs[msg] = (textMsgs[msg] ?? 0) + 1;
            const wins: Record<string, [string, string]> = {
              '#Terrorists_Win': ['T', 'eliminated'], '#CTs_Win': ['CT', 'eliminated'], '#Target_Bombed': ['T', 'bomb exploded'],
              '#Bomb_Defused': ['CT', 'bomb defused'], '#Target_Saved': ['CT', 'time ran out'], '#Round_Draw': ['draw', 'draw'],
              '#Hostages_Not_Rescued': ['T', 'time ran out'], '#All_Hostages_Rescued': ['CT', 'hostages rescued'], '#VIP_Escaped': ['CT', 'VIP escaped'],
            };
            if (wins[msg] && cur && cur.end === undefined) {
              cur.end = r1(t); cur.winner = wins[msg][0]; cur.reason = wins[msg][1];
            } else if (wins[msg] && cur && cur.reason === 'eliminated') cur.reason = wins[msg][1];
            if (msg === '#Game_will_restart_in') restartAt = t + Number(p.str() || 1);
            if (msg === '#Game_Commencing') restartAt = t + 3;
            if (msg === '#Bomb_Planted') bomb.push({ t: r1(t), what: 'planted' });
            break;
          }
          case 'SayText': { p.u8(); chat.push({ t: r1(t), text: p.str().trim() }); break; }
          case 'SendAudio': { const who = p.u8(); radio.push({ t: r1(t), who: nameOf(who), sound: p.str() }); break; }
          case 'TeamScore': { const team = p.str(); teamScore[team] = p.i16(); if (cur) cur.score = { ...teamScore }; break; }
          case 'ScoreInfo': { const id = p.u8(); const frags = p.i16(), deaths = p.i16(); p.i16(); const team = p.i16(); scoreboard.set(id, { frags, deaths, team }); break; }
          case 'BombDrop': { const at = [p.coord(), p.coord(), p.coord()]; const flag = p.u8(); bomb.push({ t: r1(t), what: flag ? 'planted at' : 'dropped at', where: at.map(Math.round) }); break; }
          case 'BombPickup': bomb.push({ t: r1(t), what: 'picked up' }); break;
          case 'ClCorpse': {
            // CS 1.5 layout: model, origin (x128 longs), angles, delay, sequence, body. No player number:
            // corpses come in death order, so they are matched to kills in order.
            const model = p.str(); const at = [p.i32() / 128, p.i32() / 128, p.i32() / 128];
            const victim = kills[corpses.length]?.victim ?? '?';
            corpses.push({ t: r1(t), player: `${victim} (${model})`, at: at.map(Math.round) }); break;
          }
          case 'Money': recorder.money.push(p.i32()); break;
          case 'Health': recorder.healthMin = Math.min(recorder.healthMin, p.u8() || 100); break;
          case 'Damage': { p.u8(); const dmg = p.u8(); if (dmg) { recorder.damageTaken += dmg; recorder.damageEvents++; } break; }
          case 'WeapPickup': recorder.pickups.push(`weapon ${p.u8()}`); break;
          case 'ItemPickup': recorder.pickups.push(p.str()); break;
          case 'ShowMenu': { p.i16(); p.i8(); p.u8(); const menu = p.str(); recorder.menus[menu] = (recorder.menus[menu] ?? 0) + 1; break; }
        }
      }
      if (pendingEvents.length) {
        const list = [...packetEntities].sort((a, b) => a - b);
        const evd = s.deltas.get('event_t');
        for (const e of pendingEvents) {
          const ent = (e.record && evd?.getInteger(e.record, 'entindex')) || (e.entity !== undefined ? list[e.entity] : undefined);
          if (ent === undefined || ent < 1 || ent > 32) continue;
          const who = nameOf(ent);
          const what = eventNames[e.index] ?? `event${e.index}`;
          (shots[who] ??= {})[what] = (shots[who][what] ?? 0) + 1;
        }
      }
    }
  }

  // Completed rounds only (winner known).
  const done = rounds.filter((r) => r.winner);
  const players = [...names.entries()].sort((a, b) => a[0] - b[0]).map(([slot, n]) => ({
    slot, name: n, ...scoreboard.get(slot + 1), team: teams.get(slot),
    positionCoverage: netFrames ? r1((100 * (coverage.get(slot + 1) ?? 0)) / netFrames) : 0,
    shots: shots[n],
  }));
  const out = {
    demo: name, rounds: done, roundsStarted: rounds.length, kills, chat, radio, bomb, corpses, teamScore, players, director,
    textMessages: textMsgs,
    recorder: { ...recorder, localEvents: localShots, money: recorder.money.length ? { first: recorder.money[0], last: recorder.money[recorder.money.length - 1], max: Math.max(...recorder.money), updates: recorder.money.length } : undefined, pickups: recorder.pickups.length },
    trackSample: Object.fromEntries([...tracks.entries()].slice(0, 2).map(([k, v]) => [nameOf(k), v.slice(0, 5)])),
  };
  writeFileSync(join(outDir, name.replace(/\.dem$/i, '.json')), JSON.stringify(out, null, 1));
  const hs = kills.filter((k) => k.headshot).length;
  // Cross-check: kills per player (enemy kills +1, team kills and suicides -1) vs the game's own final frags.
  const fragsFromKills = new Map<string, number>();
  for (const k of kills) {
    if (k.killer === 'world') continue;
    const tk = k.killer === k.victim || (k.killerTeam && k.killerTeam === k.victimTeam);
    fragsFromKills.set(k.killer, (fragsFromKills.get(k.killer) ?? 0) + (tk ? -1 : 1));
  }
  const mismatches = players.filter((p) => p.frags !== undefined && (fragsFromKills.get(p.name) ?? 0) !== p.frags).map((p) => `${p.name} ${fragsFromKills.get(p.name) ?? 0}/${p.frags}`);
  const roundsT = done.filter((r) => r.winner === 'T').length, roundsCT = done.filter((r) => r.winner === 'CT').length;
  const fin = [...done].reverse().find((r) => r.score)?.score ?? teamScore;
  const scoreOk = (fin.TERRORIST ?? 0) === roundsT && (fin.CT ?? 0) === roundsCT;
  console.log(`CHECK ${name}: restarts ${restarts}; rounds vs TeamScore ${scoreOk ? 'MATCH' : `DIFF T ${roundsT}/${fin.TERRORIST} CT ${roundsCT}/${fin.CT}`}; frags ${mismatches.length ? 'DIFF ' + mismatches.join(', ') : 'MATCH'}`);
  console.log(`${name}: ${done.length} rounds (${done.filter((r) => r.winner === 'T').length} T / ${done.filter((r) => r.winner === 'CT').length} CT), score ${JSON.stringify(teamScore)}, ${kills.length} kills (${hs} HS), ${chat.length} chat, ${radio.length} radio, ${corpses.length} corpses, shots ${Object.values(shots).reduce((n, o) => n + Object.values(o).reduce((a, b) => a + b, 0), 0)}, pos coverage ${players.map((p) => p.positionCoverage).join('/')}`);
}
