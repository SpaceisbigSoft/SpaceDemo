// Plan 2.14 check: (1) which overview orientation puts players on drawn floor; (2) do bomb plants fall inside a site.
//   npx tsx tools/dev/map-check.ts <demos folder> <overviews folder> <maps folder>...
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import { parseOverview, projection } from '../../engine/src/map/overview.js';
import { readMapFacts, siteAt } from '../../engine/src/map/bsp.js';
import { indexMaps, matchMap } from '../../engine/src/map-index.js';

const [demoDir, ovDir, ...mapDirs] = process.argv.slice(2);
const files: string[] = [];
const collect = (p: string) => statSync(p).isDirectory() ? readdirSync(p).sort().forEach((e) => collect(join(p, e))) : extname(p).toLowerCase() === '.dem' && files.push(p);
collect(demoDir);
const maps = indexMaps(mapDirs);

function bmp(path: string) {
  const b = readFileSync(path);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22);
  const row = Math.ceil(w / 4) * 4;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : b[off + (h - 1 - y) * row + x]);
  const bg = at(2, 2);
  return { at, bg, w, h };
}

const byMap = new Map<string, { pts: [number, number][]; plants: { demo: string; at: [number, number, number] }[]; checksum: number }>();
for (const f of files) {
  const demo = readDemo(new Uint8Array(readFileSync(f)));
  const m = extractMatch(demo, { tracks: true, samplesPerSecond: 1 });
  const e = byMap.get(m.map) ?? { pts: [], plants: [], checksum: demo.header.mapChecksum };
  for (const tr of m.tracks ?? []) for (const p of tr.seen) if (p.alive) e.pts.push([p.x, p.y]);
  for (const b of m.bomb) if (b.kind === 'planted' && b.position) e.plants.push({ demo: basename(f), at: b.position });
  byMap.set(m.map, e);
}
for (const [map, e] of byMap) {
  const ovTxt = join(ovDir, `${map}.txt`);
  let line = `${map}: ${e.pts.length} positions`;
  if (existsSync(ovTxt)) {
    const o = parseOverview(readFileSync(ovTxt, 'latin1'));
    const img = bmp(join(ovDir, `${map}.bmp`));
    const rates = [0].map(() => {
      const pr = projection(o);
      let on = 0;
      for (const [x, y] of e.pts) { const [px, py] = pr(x, y); const c = img.at(Math.round(px), Math.round(py)); if (c !== -1 && c !== img.bg) on++; }
      return Math.round((100 * on) / e.pts.length);
    });
    line += `; overview rotated=${o.rotated} on floor ${rates[0]}%`;
  } else line += '; no overview';
  const mm = matchMap(maps, map, e.checksum);
  if (mm.status === 'ok' || mm.status === 'renamed') {
    const facts = readMapFacts(new Uint8Array(readFileSync(mm.file.path)));
    const inside = e.plants.map((p) => siteAt(facts.bombSites, p.at));
    const counts: Record<string, number> = {};
    for (const s of inside) counts[s ?? 'none'] = (counts[s ?? 'none'] ?? 0) + 1;
    line += `; sites ${facts.bombSites.map((s) => `${s.index}:${s.source} [${s.mins.map(Math.round)}]..[${s.maxs.map(Math.round)}]`).join(' ')}; plants ${e.plants.length} → ${JSON.stringify(counts)}; spawns CT ${facts.spawnsCT.length} T ${facts.spawnsT.length}`;
    const out = e.plants.filter((p, i) => inside[i] === undefined).slice(0, 3).map((p) => `${p.demo} ${p.at.map(Math.round)}`);
    if (out.length) line += `; outside e.g. ${out.join(' | ')}`;
  } else line += `; map file ${mm.status}`;
  console.log(line);
}
