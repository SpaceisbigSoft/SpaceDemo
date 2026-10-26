// Plan 2.15 check: build the walkable-area map per map version and measure it against real movement.
//   npx tsx tools/dev/walk-check.ts <tracks json folder> <maps folder>...
// (tracks JSON = dump of extractMatch(..., { tracks: true, samplesPerSecond: 20 }) per demo, see tools/dev/dump-tracks.ts)
import { readFileSync, readdirSync } from 'node:fs';
import { indexMaps, matchMap } from '../../engine/src/map-index.js';
import { buildWalkMap, nearestNode, shortestFrom, nodePos, NodeFlag, EdgeKind, type Observation, type WalkMap } from '../../engine/src/map/walk.js';
import { readCollision, readEntityList } from '../../engine/src/map/hull.js';
import { feetAt } from '../../engine/src/map/walk.js';

const [trackDir, ...mapDirs] = process.argv.slice(2);
const maps = indexMaps(mapDirs);
type Demo = { file: string; map: string; checksum: number; recording: string; tracks: { player: number; seen: { time: number; x: number; y: number; z: number; alive: boolean }[] }[] };
const demos: Demo[] = readdirSync(trackDir).map((f) => JSON.parse(readFileSync(`${trackDir}/${f}`, 'utf8')));
const lives = (d: Demo): Observation[] => {
  const out: Observation[] = [];
  for (const t of d.tracks) {
    let cur: Observation['points'] = [];
    let last = -Infinity;
    for (const p of t.seen) {
      if (!p.alive || p.time - last > 1.5) { if (cur.length > 1) out.push({ points: cur }); cur = []; }
      if (p.alive) cur.push(p);
      last = p.time;
    }
    if (cur.length > 1) out.push({ points: cur });
  }
  return out;
};
const byMap = new Map<string, Demo[]>();
for (const d of demos) byMap.set(`${d.map}:${d.checksum}`, [...(byMap.get(`${d.map}:${d.checksum}`) ?? []), d]);

function onGraph(w: WalkMap, obs: Observation[], col: ReturnType<typeof readCollision>) {
  let n = 0, hit = 0;
  for (const o of obs) for (let i = 0; i < o.points.length; i += 4) {
    const p = o.points[i];
    const f = feetAt(col, [p.x, p.y, p.z]);
    if (!f) continue; n++;
    const k = nearestNode(w, [p.x, p.y, f.z], 1, false);
    if (k !== undefined && Math.abs(w.nodes[k].z - f.z) < 40) hit++;
  }
  return { n, pct: (100 * hit) / n };
}

for (const [k, ds] of byMap) {
  const [map, crc] = k.split(':');
  const mm = matchMap(maps, map, Number(crc));
  if (mm.status !== 'ok' && mm.status !== 'renamed') { console.log(map, 'no map file'); continue; }
  const bsp = new Uint8Array(readFileSync(mm.file.path));
  const col = readCollision(bsp, readEntityList(bsp));
  const t0 = Date.now();
  const geo = buildWalkMap(bsp, { noObservations: true });
  const tGeo = Date.now() - t0;
  const allObs = ds.flatMap(lives);
  const full = buildWalkMap(bsp, { observations: allObs });
  const edges = (w: WalkMap) => w.edges.reduce((a, e) => a + e.length, 0);
  const crouch = geo.nodes.filter((n) => n.flags & NodeFlag.CrouchOnly).length;
  const obsOnly = full.nodes.filter((n) => !(n.flags & NodeFlag.Geometry)).length;
  console.log(`\n== ${map} (${ds.length} demos) map-only: ${geo.nodes.length} spots (${crouch} crouch-only), ${edges(geo)} links, built in ${(tGeo / 1000).toFixed(1)} s; with demos: ${full.nodes.length} spots (${obsOnly} only from demos), ${edges(full)} links`);
  // A) Coverage: positions from the demos that land on a map-only spot; and leave-one-demo-out with demos added.
  const g = onGraph(geo, allObs, col);
  console.log(`  A1 map-only covers ${g.pct.toFixed(1)} % of ${g.n} ground positions`);
  for (const d of ds) {
    const other = ds.filter((x) => x !== d).flatMap(lives);
    const w = buildWalkMap(bsp, { observations: other });
    const r = onGraph(w, lives(d), col);
    console.log(`  A2 ${d.file.padEnd(32)} covered by map + other demos: ${r.pct.toFixed(2)} %`);
  }
  // B) Shortest path must never be longer than what a player actually walked (else a short cut is missing).
  for (const [name, w] of [['map-only', geo], ['map+demos', full]] as const) {
    let pairs = 0, longer = 0, unreachable = 0; const ratios: number[] = []; const straightRatios: number[] = []; const bad: string[] = [];
    for (const o of allObs) {
      const pts = o.points;
      for (let i = 0; i + 1 < pts.length; i += 40) {
        // walk ~8 s ahead (20 samples/s)
        const j = Math.min(pts.length - 1, i + 160);
        if (pts[j].time - pts[i].time < 3) continue;
        let walked = 0;
        for (let k = i + 1; k <= j; k++) walked += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
        if (walked < 300) continue;
        const fa = feetAt(col, [pts[i].x, pts[i].y, pts[i].z]), fb = feetAt(col, [pts[j].x, pts[j].y, pts[j].z]);
        if (!fa || !fb) continue;
        const a = nearestNode(w, [pts[i].x, pts[i].y, fa.z], 2, false), b = nearestNode(w, [pts[j].x, pts[j].y, fb.z], 2, false);
        if (a === undefined || b === undefined) { unreachable++; pairs++; continue; }
        const sp = shortestFrom(w, a, walked * 3);
        pairs++;
        const c = sp.cost[b];
        if (!Number.isFinite(c)) { unreachable++; if (bad.length < 3) bad.push(`${pts[i].x},${pts[i].y},${pts[i].z} → ${pts[j].x},${pts[j].y},${pts[j].z}`); continue; }
        ratios.push(c / walked);
        const straight = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y, pts[j].z - pts[i].z);
        if (straight > 0.9 * walked) straightRatios.push(c / walked);
        if (c > walked * 1.15 + 64) { longer++; if (bad.length < 3) bad.push(`${pts[i].x},${pts[i].y},${pts[i].z} → ${pts[j].x},${pts[j].y},${pts[j].z} path ${c.toFixed(0)} walked ${walked.toFixed(0)}`); }
      }
    }
    ratios.sort((a, b) => a - b);
    straightRatios.sort((a, b) => a - b);
    const q = (f: number) => straightRatios[Math.floor(f * (straightRatios.length - 1))]?.toFixed(2);
    console.log(`  B ${name.padEnd(9)} ${pairs} walks of 3–8 s: path ≤ walked in ${(100 * (pairs - longer - unreachable) / pairs).toFixed(1)} %, longer ${longer}, unreachable ${unreachable}; straight walks (${straightRatios.length}): path/walked p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)}`, bad.length ? `e.g. ${bad.join(' | ')}` : '');
  }
}
