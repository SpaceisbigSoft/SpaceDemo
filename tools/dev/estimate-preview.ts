// Plan 2.16 picture for the owner: one player in one round — POV anchors, estimate (+ radius), HLTV truth.
//   npx tsx tools/dev/estimate-preview.ts <tracks folder> <pov file> <hltv file> <offset s> <player name> <round> <out.json> <maps folder>...
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexMaps, matchMap } from '../../engine/src/map-index.js';
import { readMapFacts } from '../../engine/src/map/bsp.js';
import { buildWalkMap, observationsFrom } from '../../engine/src/map/walk.js';
import { estimateLife, livesOf } from '../../engine/src/match/estimate.js';
const [dir, povF, hlF, offS, name, roundS, out, ...mapDirs] = process.argv.slice(2);
const pov = JSON.parse(readFileSync(join(dir, povF), 'utf8')), hl = JSON.parse(readFileSync(join(dir, hlF), 'utf8'));
const off = Number(offS), sh = (t: number) => t + off;
const mm = matchMap(indexMaps(mapDirs), pov.map, pov.checksum) as any;
const bsp = new Uint8Array(readFileSync(mm.file.path));
const facts = readMapFacts(bsp);
const w = buildWalkMap(bsp, { observations: observationsFrom(pov.tracks) });
const p = pov.players.find((x: any) => x.name === name && pov.tracks.some((t: any) => t.player === x.id && t.seen.length));
const tr = pov.tracks.find((t: any) => t.player === p.id);
const mv = (l: any[]) => l.map((q) => ({ ...q, time: sh(q.time) }));
const rounds = pov.rounds.map((r: any) => ({ ...r, start: sh(r.start), freezeEnd: r.freezeEnd && sh(r.freezeEnd), end: r.end && sh(r.end) }));
const lives = livesOf(p.id, { rounds, kills: pov.kills.map((k: any) => ({ ...k, time: sh(k.time) })), deaths: pov.deaths.map((k: any) => ({ ...k, time: sh(k.time) })), track: { seen: mv(tr.seen), radar: mv(tr.radar), heard: mv(tr.heard) }, spawns: p.team === 'T' ? facts.spawnsT : facts.spawnsCT });
const r = rounds.find((x: any) => x.number === Number(roundS));
const life = lives.find((l) => Math.abs(l.start - r.start) < 1)!;
const est = estimateLife(w, life);
const ids = hl.players.filter((x: any) => x.name === name).map((x: any) => x.id);
const truth = hl.tracks.filter((t: any) => ids.includes(t.player)).flatMap((t: any) => t.seen).filter((q: any) => q.alive && q.time >= life.start && q.time <= life.end).sort((a: any, b: any) => a.time - b.time);
writeFileSync(out, JSON.stringify({ map: pov.map, player: name, team: p.team, round: r.number, start: life.start, end: life.end, anchors: life.anchors, est, truth: truth.map((q: any) => [q.time, q.x, q.y]) }));
const errs = est.filter((e) => e.source === 'estimated').map((e) => { const t = truth.reduce((b: any, q: any) => (Math.abs(q.time - e.time) < Math.abs(b.time - e.time) ? q : b), truth[0]); return Math.hypot(t.x - e.x, t.y - e.y); }).sort((a, b) => a - b);
console.log(`${name} round ${r.number}: ${life.anchors.length} anchors, ${est.length} points, estimated ${errs.length}, median error ${Math.round(errs[Math.floor(errs.length / 2)] ?? 0)}`);
