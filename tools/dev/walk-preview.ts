// Plan 2.14/2.15 owner check: per map version, export what the preview picture needs (walkable spots, bomb sites with
// letters, spawns, shortest routes spawn → site). Rendered by tools/dev/walk-preview.py.
//   npx tsx tools/dev/walk-preview.ts <tracks json folder> <out folder> <overviews folder> <maps folder>...
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { indexMaps, matchMap } from '../../engine/src/map-index.js';
import { readMapFacts, applySiteLetters } from '../../engine/src/map/bsp.js';
import { parseOverview } from '../../engine/src/map/overview.js';
import { buildWalkMap, nearestNode, nodePos, observationsFrom, pathTo, shortestFrom, NodeFlag } from '../../engine/src/map/walk.js';

const [trackDir, outDir, ovDir, ...mapDirs] = process.argv.slice(2);
const maps = indexMaps(mapDirs);
const demos = readdirSync(trackDir).map((f) => JSON.parse(readFileSync(join(trackDir, f), 'utf8')));
const groups = new Map<string, any[]>();
for (const d of demos) groups.set(`${d.map}:${d.checksum}`, [...(groups.get(`${d.map}:${d.checksum}`) ?? []), d]);
for (const [k, ds] of groups) {
  const [map, crc] = k.split(':');
  const mm = matchMap(maps, map, Number(crc)) as any;
  const bsp = new Uint8Array(readFileSync(mm.file.path));
  const facts = readMapFacts(bsp);
  const sites = applySiteLetters(facts.bombSites, map, Number(crc));
  const w = buildWalkMap(bsp, { observations: ds.flatMap((d) => observationsFrom(d.tracks)) });
  // Spawn groups: start from the spawn point nearest the team's average spawn.
  const mid = (a: number[][]) => [0, 1, 2].map((i) => a.reduce((s, p) => s + p[i], 0) / a.length) as [number, number, number];
  const routes: { from: string; to: string; cost: number; points: number[][] }[] = [];
  for (const [team, sp] of [['T', facts.spawnsT], ['CT', facts.spawnsCT]] as const) {
    const m = mid(sp);
    const start = sp.reduce((b, p) => (Math.hypot(p[0] - m[0], p[1] - m[1]) < Math.hypot(b[0] - m[0], b[1] - m[1]) ? p : b));
    const n0 = nearestNode(w, [start[0], start[1], start[2]], 3);
    if (n0 === undefined) continue;
    const r = shortestFrom(w, n0);
    for (const s of sites) {
      // Nearest-cost spot inside the site.
      let best = -1, bc = Infinity;
      w.nodes.forEach((n, i) => {
        const p = nodePos(n);
        if (p[0] >= s.mins[0] && p[0] <= s.maxs[0] && p[1] >= s.mins[1] && p[1] <= s.maxs[1] && p[2] >= s.mins[2] - 64 && p[2] <= s.maxs[2] + 64 && r.cost[i] < bc) { bc = r.cost[i]; best = i; }
      });
      if (best < 0) continue;
      routes.push({ from: team, to: s.letter, cost: Math.round(bc), points: pathTo(r.prev, best).map((i) => nodePos(w.nodes[i]).map(Math.round)) });
    }
  }
  const installed = mm.file.path.includes('/maps/') ? true : false;
  const ovTxt = join(ovDir, `${map}.txt`);
  const overview = installed && existsSync(ovTxt) ? { ...parseOverview(readFileSync(ovTxt, 'latin1')), bmp: join(ovDir, `${map}.bmp`) } : undefined;
  writeFileSync(join(outDir, `${map}.json`), JSON.stringify({
    map, checksum: Number(crc), demos: ds.length, overview,
    nodes: w.nodes.map((n) => [Math.round(n.x), Math.round(n.y), Math.round(n.z), n.flags & NodeFlag.Geometry ? 1 : 0]),
    sites: sites.map((s) => ({ letter: s.letter, mins: s.mins, maxs: s.maxs })),
    spawnsT: facts.spawnsT, spawnsCT: facts.spawnsCT, routes,
  }));
  console.log(map, routes.map((r) => `${r.from}→${r.to} ${r.cost} (${(r.cost / 250).toFixed(1)} s)`).join('  '));
}
