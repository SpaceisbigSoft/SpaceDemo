// Plan 2.16 hold-out test: estimate players' positions from what a POV recorder knew, and measure the error against
// the HLTV recording of the same match half (true positions).
//   npx tsx tools/dev/estimate-check.ts <tracks json folder> <maps folder>... [--timing uniform|goThenWait|waitThenGo|centred|all] [--calibrate]
// Pairs found automatically: a POV and an HLTV demo with the same map version, the same player names and the same
// round results (Set 1: MoD train CT/T, Shebang cbble CT/T).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { indexMaps, matchMap } from '../../engine/src/map-index.js';
import { readMapFacts } from '../../engine/src/map/bsp.js';
import { buildWalkMap, observationsFrom, type WalkMap } from '../../engine/src/map/walk.js';
import { estimateLife, livesOf, setCalibration, type EstimatedPoint, type Timing } from '../../engine/src/match/estimate.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const timingArg = opt('--timing') ?? 'all';
const onlyMap = opt('--map');
const calibIn = opt('--use-calibration');
const calibrate = args.includes('--calibrate') ? (args.splice(args.indexOf('--calibrate'), 1), true) : false;
const [trackDir, ...mapDirs] = args;
const maps = indexMaps(mapDirs);
if (calibIn) setCalibration(JSON.parse(readFileSync(calibIn, 'utf8')));
type D = any;
const demos: D[] = readdirSync(trackDir).map((f) => JSON.parse(readFileSync(join(trackDir, f), 'utf8')));
const nameOf = (d: D, id: number) => d.players.find((p: D) => p.id === id)?.name;
const winners = (d: D) => d.rounds.map((r: D) => r.winner?.[0] ?? '?').join('');

// --- pairs: POV + HLTV, same map version, same names, kills that match
type Pair = { pov: D; hltv: D; offset: number; matched: number };
const pairs: Pair[] = [];
for (const h of demos.filter((d) => d.recording === 'HLTV')) {
  let best: Pair | undefined;
  for (const p of demos.filter((d) => d.recording === 'POV' && d.map === h.map && d.checksum === h.checksum)) {
    const key = (d: D, k: D) => `${nameOf(d, k.killer)}>${nameOf(d, k.victim)}>${k.weapon}`;
    const hk = h.kills.map((k: D) => ({ k: key(h, k), t: k.time }));
    const offs: number[] = [];
    let j = 0;
    for (const k of p.kills) {
      const kk = key(p, k);
      const m = hk.findIndex((x: D, i: number) => i >= j && x.k === kk);
      if (m >= 0) { offs.push(hk[m].t - k.time); j = m + 1; }
    }
    if (offs.length < 10) continue;
    offs.sort((a, b) => a - b);
    const med = offs[Math.floor(offs.length / 2)];
    const consistent = offs.filter((o) => Math.abs(o - med) < 1).length;
    if (consistent < 10) continue;
    if (!best || consistent > best.matched) best = { pov: p, hltv: h, offset: med, matched: consistent };
  }
  if (best) pairs.push(best);
}
console.log(`Pairs: ${pairs.map((p) => `${p.pov.file} ↔ ${p.hltv.file} (${p.matched} kills matched, clock offset ${p.offset.toFixed(2)} s)`).join('; ')}`);

type Rec = { pair: string; player: string; t: number; err: number; err3: number; tau: number; gap: number; radius: number; source: string; timing: string; impossible?: boolean; map: string };
const recs: Rec[] = [];
const timings: string[] = timingArg === 'all' ? ['adaptive', 'uniform', 'goThenWait', 'mixed0.25', 'hold', 'straight'] : [timingArg];
const walkCache = new Map<string, WalkMap>();
for (const { pov, hltv, offset } of pairs) {
  if (onlyMap && pov.map !== onlyMap) continue;
  const mm = matchMap(maps, pov.map, pov.checksum) as D;
  const bsp = new Uint8Array(readFileSync(mm.file.path));
  const facts = readMapFacts(bsp);
  // Walk map: the map + every demo of this map version except the HLTV under test.
  const wkey = `${hltv.file}`;
  const w = walkCache.get(wkey) ?? buildWalkMap(bsp, { observations: demos.filter((d) => d.map === pov.map && d.checksum === pov.checksum && d !== hltv).flatMap((d) => observationsFrom(d.tracks)) });
  walkCache.set(wkey, w);
  const shift = (t: number) => t + offset;
  // POV data on the HLTV clock.
  const rounds = pov.rounds.map((r: D) => ({ ...r, start: shift(r.start), freezeEnd: r.freezeEnd !== undefined ? shift(r.freezeEnd) : undefined, end: r.end !== undefined ? shift(r.end) : undefined }));
  const kills = pov.kills.map((k: D) => ({ ...k, time: shift(k.time) }));
  const deaths = pov.deaths.map((x: D) => ({ ...x, time: shift(x.time) }));
  for (const pp of pov.players) {
    if (pp.isHltv || pp.isRecorder || !pp.team || (pp.team !== 'T' && pp.team !== 'CT')) continue;
    // Same name on the HLTV side (several ids possible: reconnects) → truth = all their seen points.
    const hids = hltv.players.filter((x: D) => x.name === pp.name).map((x: D) => x.id);
    const truth = hltv.tracks.filter((t: D) => hids.includes(t.player)).flatMap((t: D) => t.seen.filter((s: D) => s.alive)).sort((a: D, b: D) => a.time - b.time);
    if (truth.length === 0) continue;
    const tr = pov.tracks.find((t: D) => t.player === pp.id);
    const mv = (l: D[]) => (l ?? []).map((p: D) => ({ ...p, time: shift(p.time) }));
    const lives = livesOf(pp.id, { rounds, kills, deaths, track: tr ? { seen: mv(tr.seen), radar: mv(tr.radar), heard: mv(tr.heard) } : undefined, leftAt: pp.leftAt !== undefined ? shift(pp.leftAt) : undefined, spawns: pp.team === 'T' ? facts.spawnsT : facts.spawnsCT });
    for (const life of lives) {
      const anchorTimes = life.anchors.map((a) => a.time);
      const tauOf = (t: number) => { let m = Infinity; for (const a of anchorTimes) m = Math.min(m, Math.abs(a - t)); return m; };
      const gapOf = (t: number) => { let before = -Infinity, after = Infinity; for (const a of anchorTimes) { if (a <= t) before = Math.max(before, a); else after = Math.min(after, a); } return after - before; };
      for (const timing of timings) {
        const est: EstimatedPoint[] = timing === 'hold' || timing === 'straight'
          ? estimateLife(timing === 'straight' ? undefined : w, timing === 'hold' ? { ...life, anchors: life.anchors } : life, { timing: 'uniform', step: 0.25 }).map((e) => e)
          : estimateLife(w, life, timing.startsWith('mixed') ? { timing: 'mixed', mix: Number(timing.slice(5)), step: 0.25 } : { timing: timing as Timing, step: 0.25 });
        // 'hold': replace estimates by the last known anchor position.
        const lastAnchor = (t: number) => { let a = life.anchors[0]; for (const x of life.anchors) if (x.time <= t) a = x; return a; };
        const byTime = new Map(est.map((e) => [Math.round(e.time * 4), e]));
        let lastBucket = -1;
        for (const s of truth) {
          if (s.time < life.start + 0.3 || s.time > life.end - 0.1) continue;
          const bucket = Math.floor(s.time * 2); // ~2 moments per second
          if (bucket === lastBucket) continue;
          lastBucket = bucket;
          const e = byTime.get(Math.round(s.time * 4));
          if (!e) continue;
          let p: [number, number, number] = [e.x, e.y, e.z];
          if (timing === 'hold' && e.source === 'estimated') { const a = lastAnchor(s.time); p = a.pos; }
          const err = Math.hypot(p[0] - s.x, p[1] - s.y), err3 = Math.hypot(err, p[2] - s.z);
          recs.push({ pair: pov.file, player: pp.name, t: s.time, err, err3, tau: tauOf(s.time), gap: gapOf(s.time), radius: e.radius, source: e.source, timing, impossible: e.impossible, map: pov.map });
        }
      }
    }
  }
}

const q = (v: number[], f: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor(f * (s.length - 1))]; };
const fmt = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : '–').padStart(5);
console.log(`\nAll moments (2/s while alive), by source (timing uniform):`);
for (const src of ['seen', 'radar', 'heard', 'death', 'spawn', 'estimated', 'held']) {
  const r = recs.filter((x) => x.timing === (timings[0] === 'hold' ? 'uniform' : timings[0]) && x.source === src).map((x) => x.err);
  if (r.length) console.log(`  ${src.padEnd(10)} n=${String(r.length).padStart(6)}  median ${fmt(q(r, 0.5))}  p80 ${fmt(q(r, 0.8))}  p90 ${fmt(q(r, 0.9))}`);
}
const gapBuckets: [number, number][] = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 1e9]];
console.log(`\nEstimated moments ("estimated" = between two anchors): 2D error median / p90 (units) by gap length`);
console.log(`  ${'timing'.padEnd(11)} ${gapBuckets.map(([a, b]) => `${a}–${b > 1e8 ? '…' : b} s`.padStart(13)).join('')}   all (n)`);
for (const timing of timings) {
  const base = recs.filter((x) => x.timing === timing && x.source === 'estimated');
  const cells = gapBuckets.map(([a, b]) => { const r = base.filter((x) => x.gap >= a && x.gap < b).map((x) => x.err); return `${fmt(q(r, 0.5))}/${fmt(q(r, 0.9))}`.padStart(13); });
  console.log(`  ${timing.padEnd(11)} ${cells.join('')}   ${fmt(q(base.map((x) => x.err), 0.5))}/${fmt(q(base.map((x) => x.err), 0.9))} (${base.length})`);
}
const best = timings[0] === 'hold' ? 'uniform' : (process.env.BEST ?? 'uniform');
const est = recs.filter((x) => x.timing === best && (x.source === 'estimated' || x.source === 'held'));
console.log(`\nBy time to nearest anchor (${best}; estimated + held): p80 error → radius, share within 256 → confidence, share within the given radius`);
const tauB: [number, number][] = [[0, 0.5], [0.5, 1], [1, 2], [2, 3], [3, 5], [5, 10], [10, 20], [20, 1e9]];
for (const kind of ['estimated', 'held']) {
  for (const [a, b] of tauB) {
    const r = est.filter((x) => x.source === kind && x.tau >= a && x.tau < b);
    if (r.length < 20) continue;
    const e = r.map((x) => x.err);
    const inR = r.filter((x) => x.err <= x.radius).length / r.length;
    console.log(`  ${kind.padEnd(9)} τ ${String(a).padStart(4)}–${b > 1e8 ? '…' : b} s  n=${String(r.length).padStart(5)}  median ${fmt(q(e, 0.5))}  p80 ${fmt(q(e, 0.8))}  ≤256: ${(100 * e.filter((v) => v <= 256).length / e.length).toFixed(0).padStart(3)} %  within radius: ${(100 * inR).toFixed(0)} %`);
  }
}
if (process.env.BYPAIR) for (const pr of new Set(recs.map((x) => x.pair))) for (const src of ['spawn', 'held', 'estimated']) {
  const r = recs.filter((x) => x.pair === pr && x.timing === 'uniform' && x.source === src);
  const worst = [...r].sort((a, b) => b.err - a.err)[0];
  console.log(`  ${pr.padEnd(18)} ${src.padEnd(9)} n=${String(r.length).padStart(5)} median ${fmt(q(r.map((x) => x.err), 0.5))} p90 ${fmt(q(r.map((x) => x.err), 0.9))}  worst ${worst ? `${worst.player} t=${worst.t} err ${Math.round(worst.err)}` : ''}`);
}
const imp = recs.filter((x) => x.timing === best && x.impossible).length;
console.log(`\nImpossible-gap flags: ${imp} moments (${(100 * imp / Math.max(1, est.length)).toFixed(2)} % of estimated)`);
if (calibrate) {
  const table = (kind: string) => tauB.map(([a, b]) => {
    const e = est.filter((x) => x.source === kind && x.tau >= a && x.tau < b).map((x) => x.err);
    if (e.length < 20) return undefined;
    return [Math.round(((a + Math.min(b, a * 2 + 10)) / 2) * 10) / 10, Math.round(q(e, 0.8)), Math.round((100 * e.filter((v) => v <= 256).length) / e.length) / 100];
  }).filter(Boolean);
  console.log('\nCALIBRATION = ' + JSON.stringify({ between: table('estimated'), held: table('held') }));
}
