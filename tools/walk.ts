// Walkable-area map of one map version (plan 2.15): where players can stand and how they can move, from the map's own
// collision data plus the movements seen in demos recorded on that exact map version. Map and demo files are only read.
//   npm run walk -- <map.bsp> [--demos <folder>] [--json <out.json>] [--route <x,y,z> <x,y,z>]
// --json writes the compact graph (cache it per map checksum). --route prints the shortest walk between two points
// (player origins).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { readDemo } from '../engine/src/container/read.js';
import { extractMatch } from '../engine/src/match/extract.js';
import { mapChecksumFile } from '../engine/src/mapcrc.js';
import { readMapFacts } from '../engine/src/map/bsp.js';
import { buildWalkMap, nearestNode, nodePos, observationsFrom, pathTo, serializeWalkMap, shortestFrom, NodeFlag, EdgeKind, type Observation } from '../engine/src/map/walk.js';

const args = process.argv.slice(2);
const opt = (k: string, n = 1) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, n + 1).slice(1) : undefined; };
const demoDir = opt('--demos')?.[0], jsonOut = opt('--json')?.[0], route = opt('--route', 2);
const [bspPath] = args;
if (!bspPath) {
  console.log('Usage: npm run walk -- <map.bsp> [--demos <folder>] [--json <out.json>] [--route <x,y,z> <x,y,z>]');
  process.exit(1);
}
const bsp = new Uint8Array(readFileSync(bspPath));
const checksum = mapChecksumFile(bspPath);

const observations: Observation[] = [];
let used = 0, skipped = 0;
if (demoDir) {
  const files: string[] = [];
  const walk = (p: string) => (statSync(p).isDirectory() ? readdirSync(p).sort().forEach((e) => walk(join(p, e))) : extname(p).toLowerCase() === '.dem' && files.push(p));
  walk(demoDir);
  for (const f of files) {
    const demo = readDemo(new Uint8Array(readFileSync(f)));
    // Only demos recorded on this exact map version.
    if (demo.header.mapChecksum !== checksum) { skipped++; continue; }
    const m = extractMatch(demo, { tracks: true, samplesPerSecond: 20 });
    observations.push(...observationsFrom(m.tracks ?? []));
    used++;
  }
}
const t0 = Date.now();
const w = buildWalkMap(bsp, { observations });
const links = w.edges.reduce((a, e) => a + e.length, 0);
const count = (f: number) => w.nodes.filter((n) => n.flags & f).length;
console.log(`Map checksum ${checksum}; demos used ${used}${skipped ? `, ${skipped} skipped (other map version)` : ''}`);
console.log(`Walkable spots: ${w.nodes.length} (${count(NodeFlag.CrouchOnly)} crouch-only, ${w.nodes.filter((n) => !(n.flags & NodeFlag.Geometry)).length} known only from demos); links: ${links} (${w.edges.flat().filter((e) => e.kind === EdgeKind.Ladder).length} ladder); built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const sites = readMapFacts(bsp).bombSites;
for (const s of sites) console.log(`Bomb site ${s.letter}: [${s.mins.map(Math.round)}]..[${s.maxs.map(Math.round)}]`);

if (route) {
  const [a, b] = route.map((r) => r.split(',').map(Number) as [number, number, number]);
  const na = nearestNode(w, a), nb = nearestNode(w, b);
  if (na === undefined || nb === undefined) console.log('Route: a point is not on the walkable map');
  else {
    const sp = shortestFrom(w, na);
    const c = sp.cost[nb];
    if (!Number.isFinite(c)) console.log('Route: no walkable way between the two points');
    else {
      const path = pathTo(sp.prev, nb);
      console.log(`Route: ${Math.round(c)} units (≈ ${(c / 250).toFixed(1)} s at full knife speed), ${path.length} spots`);
      console.log('  ' + path.filter((_, i) => i % 8 === 0 || i === path.length - 1).map((i) => nodePos(w.nodes[i]).map(Math.round).join(',')).join(' → '));
    }
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ map: bspPath, checksum, ...serializeWalkMap(w) }));
