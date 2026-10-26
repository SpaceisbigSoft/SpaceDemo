import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { extractMatch } from '../src/match/extract.js';
import { parseEntities, readMapFacts, siteAt, type BombSite } from '../src/map/bsp.js';
import { parseOverview, projection, unprojection } from '../src/map/overview.js';
import { indexMaps, matchMap } from '../src/map-index.js';
import { fixtureDemos } from './fixtures.js';

describe('overview description', () => {
  const o = parseOverview('global\n{\n\tZOOM\t1.56\n\tORIGIN\t32 \t156\t-360\n\tROTATED\t1\n}\nlayer\n{\n\tIMAGE\t"overviews/de_train.bmp"\n\tHEIGHT\t-360\n}');
  it('is parsed', () => {
    expect(o).toEqual({ zoom: 1.56, origin: [32, 156, -360], rotated: true, image: 'overviews/de_train.bmp', height: -360 });
  });
  it('maps the origin to the image centre, 8 world units per zoom pixel, y up', () => {
    const p = projection(o);
    expect(p(32, 156)).toEqual([512, 384]);
    const [px, py] = p(32 + 800, 156 + 800);
    expect(px).toBeCloseTo(512 + 156, 6);
    expect(py).toBeCloseTo(384 - 156, 6);
    const back = unprojection(o)(px, py);
    expect(back[0]).toBeCloseTo(832, 6);
    expect(back[1]).toBeCloseTo(956, 6);
  });
});

describe('map entities', () => {
  it('parses key/value blocks', () => {
    const e = parseEntities('{\n"classname" "worldspawn"\n"wad" "a.wad"\n}\n{\n"origin" "1 2 3"\n"classname" "info_player_start"\n}\n');
    expect(e.map((x) => x.classname)).toEqual(['worldspawn', 'info_player_start']);
    expect(e[1].props.origin).toBe('1 2 3');
  });
  it('tells stacked sites apart by height (de_nuke A above B)', () => {
    const sites: BombSite[] = [
      { index: 1, mins: [544, -976, -416], maxs: [816, -576, -320], source: 'func_bomb_target' },
      { index: 2, mins: [528, -1024, -768], maxs: [768, -784, -672], source: 'func_bomb_target' },
    ];
    expect(siteAt(sites, [600, -800, -380])).toBe(1);
    expect(siteAt(sites, [600, -800, -740])).toBe(2);
    expect(siteAt(sites, [0, 0, 0])).toBeUndefined();
  });
});

// Real maps: CDF_MAPS = folders with .bsp files separated by the path delimiter (e.g. cstrike/maps and Old Maps).
const mapDirs = (process.env.CDF_MAPS ?? '').split(/[:;]/).filter(Boolean);
const demos = fixtureDemos();

describe.skipIf(mapDirs.length === 0 || demos.length === 0)('bomb plants fall inside a bomb site (real maps)', () => {
  const maps = indexMaps(mapDirs);
  it.each(demos.map((d) => [basename(d), d]))('%s', (_n, path) => {
    const demo = readDemo(new Uint8Array(readFileSync(path)));
    const mm = matchMap(maps, demo.header.mapName.replace(/\.bsp$/i, ''), demo.header.mapChecksum);
    if (mm.status !== 'ok' && mm.status !== 'renamed') return;
    const facts = readMapFacts(new Uint8Array(readFileSync(mm.file.path)));
    expect(facts.bombSites.length).toBe(2);
    expect(facts.spawnsCT.length).toBeGreaterThan(0);
    expect(facts.spawnsT.length).toBeGreaterThan(0);
    const m = extractMatch(demo);
    for (const b of m.bomb) if (b.kind === 'planted' && b.position) expect(siteAt(facts.bombSites, b.position)).toBeDefined();
  });
});

// The game's overview images: CDF_OVERVIEWS = the cstrike/overviews folder.
const ovDir = process.env.CDF_OVERVIEWS;
describe.skipIf(!ovDir || demos.length === 0 || mapDirs.length === 0)('positions land on drawn floor of matching overviews', () => {
  const maps = indexMaps(mapDirs);
  const hltv = demos.filter((d) => /hltv/i.test(d));
  it.each(hltv.map((d) => [basename(d), d]))('%s', (_n, path) => {
    const demo = readDemo(new Uint8Array(readFileSync(path)));
    const name = demo.header.mapName.replace(/\.bsp$/i, '');
    const txt = join(ovDir!, `${name}.txt`);
    // Only when the installed map is the version the demo needs (the image shows today's map).
    const mm = matchMap(maps, name, demo.header.mapChecksum);
    if (!existsSync(txt) || mm.status !== 'ok' || !mm.file.path.includes(join('cstrike', 'maps'))) return;
    const o = parseOverview(readFileSync(txt, 'latin1'));
    const b = readFileSync(join(ovDir!, `${name}.bmp`));
    const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), row = Math.ceil(w / 4) * 4;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : b[off + (h - 1 - y) * row + x]);
    const bg = at(2, 2);
    const p = projection(o);
    const m = extractMatch(demo, { tracks: true, samplesPerSecond: 2 });
    let n = 0, on = 0;
    for (const tr of m.tracks!) for (const pt of tr.seen) if (pt.alive) {
      n++;
      const [px, py] = p(pt.x, pt.y);
      const c = at(Math.round(px), Math.round(py));
      if (c !== -1 && c !== bg) on++;
    }
    expect(on / n).toBeGreaterThan(0.95);
  });
});
