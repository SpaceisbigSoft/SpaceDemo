// Map facts for the radar (plan 2.14): bomb sites, spawns, the game's overview mapping, floor polygons for maps
// without a matching overview image. Map files are only read.
//   npm run map -- <map.bsp> [--overview <overviews/map.txt>] [--floor-from <demo.dem>] [--json <out.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { extractMatch } from '../engine/src/match/extract.js';
import { floorRangeFromPositions, readFloorPolygons, readMapFacts } from '../engine/src/map/bsp.js';
import { parseOverview } from '../engine/src/map/overview.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const overviewPath = opt('--overview'), floorDemo = opt('--floor-from'), jsonOut = opt('--json');
const [bspPath] = args;
if (!bspPath) {
  console.log('Usage: npm run map -- <map.bsp> [--overview <overviews/map.txt>] [--floor-from <demo.dem>] [--json <out.json>]');
  process.exit(1);
}
const bsp = new Uint8Array(readFileSync(bspPath));
const facts = readMapFacts(bsp);
console.log(`Bomb sites: ${facts.bombSites.map((s) => `${s.index} [${s.mins.map(Math.round)}]..[${s.maxs.map(Math.round)}]`).join('  ')}`);
console.log(`Spawns: CT ${facts.spawnsCT.length}, T ${facts.spawnsT.length}`);
const overview = overviewPath ? parseOverview(readFileSync(overviewPath, 'latin1')) : undefined;
if (overview) console.log(`Overview: zoom ${overview.zoom}, origin ${overview.origin.join(' ')}, image ${overview.image}`);
let range;
if (floorDemo) {
  const m = extractMatch(readDemo(new Uint8Array(readFileSync(floorDemo))), { tracks: true, samplesPerSecond: 2 });
  range = floorRangeFromPositions((m.tracks ?? []).flatMap((t) => t.seen.map((p) => p.z)));
}
const floor = readFloorPolygons(bsp, range ?? {});
console.log(`Floor polygons: ${floor.length}${range ? ` (heights ${Math.round(range.minZ)}..${Math.round(range.maxZ)} from the demo's positions)` : ' (no height filter: roofs included; pass --floor-from <demo>)'}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...facts, entities: undefined, overview, floor }, null, 0));
