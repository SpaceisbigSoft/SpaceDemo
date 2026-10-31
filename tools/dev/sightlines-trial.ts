// 5.s trial: line of sight between all players on one demo (tracks + map file). Prints timing, kills with a clear line,
// from behind, who saw first. Usage: tsx tools/dev/sightlines-trial.ts <demo.dem> <map.bsp>
import { readFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import { sightlines } from '../../engine/src/match/sightlines.js';
import { readSight } from '../../engine/src/map/sight.js';
const m = extractMatch(readDemo(new Uint8Array(readFileSync(process.argv[2]))), { tracks: true });
const sight = readSight(new Uint8Array(readFileSync(process.argv[3])));
// Sides from the kills (each kill names both sides).
const votes = new Map<number, { T: number; CT: number }>();
const vote = (id: number | null, t?: string) => { if (id === null || (t !== 'T' && t !== 'CT')) return; const v = votes.get(id) ?? { T: 0, CT: 0 }; v[t]++; votes.set(id, v); };
for (const k of m.kills) { vote(k.killer, k.killerTeam); vote(k.victim, k.victimTeam); }
const team = new Map<number, 'T' | 'CT'>();
for (const p of m.players) { const v = votes.get(p.id); const s = v ? (v.T >= v.CT ? 'T' : 'CT') : p.team; if (s === 'T' || s === 'CT') team.set(p.id, s); }
const t0 = Date.now();
const r = sightlines({ tracks: m.tracks!, kills: m.kills, rounds: m.rounds, team, sight });
const ms = Date.now() - t0;
const name = (id: number) => m.players.find((p) => p.id === id)?.name;
const known = r.kills.filter((k) => k.known);
console.log(`${m.recording} ${m.map}: ${ms} ms, ${r.checks} pair checks; kills ${r.kills.length}, both known ${known.length}`);
console.log(`clear line ${known.filter((k) => k.clear).length}/${known.length}; from behind (>110°) ${known.filter((k) => (k.offView ?? 0) > 110).length}; killer saw first ${known.filter((k) => k.killerSaw !== undefined && (k.victimSaw === undefined || k.killerSaw > k.victimSaw + 0.05)).length}, victim saw first ${known.filter((k) => k.victimSaw !== undefined && (k.killerSaw === undefined || k.victimSaw > k.killerSaw + 0.05)).length}, killer never seen seeing ${known.filter((k) => k.killerSaw === undefined).length}`);
for (const k of known.filter((k) => !k.clear)) console.log('  not clear:', k.round, k.time, name(k.killer), '>', name(k.victim), m.kills.find((x) => x.time === k.time)?.weapon);
for (const f of r.firsts.slice(0, 12)) console.log(`  R${f.round} first sight ${f.time}: ${name(f.seer)} saw ${name(f.seen)}${f.mutual ? ' (both)' : ''}`);
