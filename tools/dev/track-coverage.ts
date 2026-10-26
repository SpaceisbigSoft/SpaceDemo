// Plan 2.13 check: with exact tracks, share of each player's alive time (live rounds) with a known position,
// by source, for POV and HLTV demos; and track position vs corpse position at each death.
//   npx tsx tools/dev/track-coverage.ts <folder or demos>... [--window 1]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';

const args = process.argv.slice(2);
const wi = args.indexOf('--window');
const W = wi >= 0 ? Number(args.splice(wi, 2)[1]) : 1;
const files: string[] = [];
const collect = (p: string) => statSync(p).isDirectory() ? readdirSync(p).sort().forEach((e) => collect(join(p, e))) : extname(p).toLowerCase() === '.dem' && files.push(p);
args.forEach(collect);
type Acc = { alive: number; seen: number; radar: number; heard: number; any: number };
const acc: Record<string, Acc> = {};
const add = (k: string, a: Acc) => { const x = (acc[k] ??= { alive: 0, seen: 0, radar: 0, heard: 0, any: 0 }); for (const f of Object.keys(a) as (keyof Acc)[]) x[f] += a[f]; };
let deaths = 0, within = 0, known = 0, killsPov = 0, bothAny = 0, bothSeen = 0; const t0 = Date.now();
for (const path of files) {
  const m = extractMatch(readDemo(new Uint8Array(readFileSync(path))), { tracks: true });
  const team = new Map(m.players.map((p) => [p.id, p.team]));
  const recTeam = m.recorderId !== undefined ? team.get(m.recorderId) : undefined;
  for (const tr of m.tracks ?? []) {
    const p = m.players.find((x) => x.id === tr.player)!;
    if (p.isHltv || p.isRecorder || (p.team !== 'T' && p.team !== 'CT')) continue;
    const slots = (list: { time: number; alive: boolean }[]) => new Set(list.filter((x) => x.alive).map((x) => Math.floor(x.time / W)));
    const S = { seen: slots(tr.seen), radar: slots(tr.radar), heard: slots(tr.heard) };
    const a: Acc = { alive: 0, seen: 0, radar: 0, heard: 0, any: 0 };
    for (const r of m.rounds) {
      const death = m.kills.find((k) => k.round === r.number && k.victim === tr.player);
      for (let i = Math.ceil((r.freezeEnd ?? r.start) / W); i < Math.floor((death?.time ?? r.end!) / W); i++) {
        a.alive++; let any = false;
        for (const k of ['seen', 'radar', 'heard'] as const) if (S[k].has(i)) { a[k]++; any = true; }
        if (any) a.any++;
      }
    }
    add(m.recording === 'HLTV' ? 'HLTV' : p.team === recTeam ? 'POV teammates' : 'POV enemies', a);
  }
  if (m.recording === 'POV') for (const k of m.kills) {
    if (k.killer === null || k.suicide) continue;
    killsPov++;
    const knownAt = (id: number, srcs: ('seen' | 'radar' | 'heard')[]) => {
      if (id === m.recorderId) return true;
      const tr = m.tracks?.find((x) => x.player === id);
      return !!tr && srcs.some((s) => tr[s].some((x) => Math.abs(x.time - k.time) <= 1));
    };
    if (knownAt(k.killer, ['seen', 'radar', 'heard']) && knownAt(k.victim, ['seen', 'radar', 'heard'])) bothAny++;
    if (knownAt(k.killer, ['seen']) && knownAt(k.victim, ['seen'])) bothSeen++;
  }
  for (const d of m.deaths) {
    if (d.victim === undefined) continue;
    const k = m.kills.find((k) => k.victim === d.victim && k.time <= d.time && d.time - k.time < 8); if (!k) continue;
    deaths++;
    const tr = m.tracks?.find((x) => x.player === d.victim); const pts = tr?.seen.filter((x) => x.time <= k.time && k.time - x.time < 1) ?? [];
    const p = pts[pts.length - 1]; if (!p) continue; known++;
    if (Math.hypot(p.x - d.position[0], p.y - d.position[1]) < 50) within++;
  }
  process.stderr.write(`${basename(path)} `);
}
const pct = (a: number, b: number) => `${Math.round((100 * a) / b)}%`;
console.log(`\nwindow ${W}s, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const [k, a] of Object.entries(acc)) console.log(`${k}: known ${pct(a.any, a.alive)} (seen ${pct(a.seen, a.alive)}, radar ${pct(a.radar, a.alive)}, heard ${pct(a.heard, a.alive)}) of ${Math.round((a.alive * W) / 60)} alive-minutes`);
console.log(`POV kills: ${killsPov}; both positions known within ±1 s: ${pct(bothAny, killsPov)} (both seen exactly: ${pct(bothSeen, killsPov)})`);
console.log(`deaths: ${deaths}; track position known at the kill: ${pct(known, deaths)}; within 50 units of the corpse: ${pct(within, known)}`);
