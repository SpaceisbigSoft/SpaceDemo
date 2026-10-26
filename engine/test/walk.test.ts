import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { extractMatch } from '../src/match/extract.js';
import { applySiteLetters, readMapFacts } from '../src/map/bsp.js';
import { HULL_CROUCHING, readCollision, readEntityList } from '../src/map/hull.js';
import { indexMaps, matchMap } from '../src/map-index.js';
import {
  buildWalkMap, deserializeWalkMap, EdgeKind, feetAt, nearestNode, nodePos, observationsFrom, pathTo, serializeWalkMap, shortestFrom,
  type WalkMap,
} from '../src/map/walk.js';
import { fixtureDemos } from './fixtures.js';

/** A tiny hand-made map: a corridor of 4 spots, a one-way drop, and a spot on a second floor above spot 1. */
function tiny(): WalkMap {
  const n = (ix: number, z: number) => ({ ix, iy: 0, x: ix * 32 + 16, y: 16, z, flags: 1, visits: 0 });
  const nodes = [n(0, 0), n(1, 0), n(2, 0), n(3, 0), n(1, 200)];
  const e = (to: number, cost: number, kind = EdgeKind.Walk) => ({ to, cost, kind });
  const edges = [[e(1, 32)], [e(0, 32), e(2, 32)], [e(1, 32), e(3, 32)], [e(2, 32)], [e(1, 200, EdgeKind.Drop)]];
  const columns = new Map<string, number[]>();
  nodes.forEach((nd, i) => columns.set(`${nd.ix},${nd.iy}`, [...(columns.get(`${nd.ix},${nd.iy}`) ?? []), i]));
  return { nodes, edges, columns };
}

describe('walk graph basics', () => {
  it('finds shortest paths and respects one-way drops', () => {
    const w = tiny();
    const a = shortestFrom(w, 0);
    expect(a.cost[3]).toBe(96);
    expect(pathTo(a.prev, 3)).toEqual([0, 1, 2, 3]);
    expect(a.cost[4]).toBe(Infinity); // can't climb back up a 200-unit drop
    const b = shortestFrom(w, 4);
    expect(b.cost[3]).toBe(264);
  });
  it('picks the floor that matches the height', () => {
    const w = tiny();
    expect(nearestNode(w, [48, 16, 36])).toBe(1); // origin 36 above the lower floor
    expect(nearestNode(w, [48, 16, 236])).toBe(4); // on the upper floor
    expect(nearestNode(w, [5000, 0, 0])).toBeUndefined();
  });
  it('survives the compact cache format', () => {
    const w = tiny();
    const back = deserializeWalkMap(JSON.parse(JSON.stringify(serializeWalkMap(w))));
    expect(back.nodes).toEqual(w.nodes);
    expect(back.edges).toEqual(w.edges);
  });
  it('splits tracks into lives at deaths and long gaps', () => {
    const p = (time: number, alive = true) => ({ time, x: 0, y: 0, z: 0, alive });
    const lives = observationsFrom([{ seen: [p(0), p(0.1), p(0.2, false), p(5), p(5.1), p(9), p(9.1)] }]);
    expect(lives.map((l) => l.points.length)).toEqual([2, 2, 2]);
  });
});

// Real maps + demos: CDF_MAPS (folders with .bsp files) and CDF_DEMOS (never committed).
const mapDirs = (process.env.CDF_MAPS ?? '').split(/[:;]/).filter(Boolean);
const demos = fixtureDemos();
// One held-out demo per map version (an HLTV one when there is one); the other demos of that version teach the graph
// what the map alone can't know (boost spots). The full measurement is tools/dev/walk-check.ts.
const perMap = new Map<string, string>();
const versionOf = new Map<string, string>();
for (const d of demos) {
  const h = readDemo(new Uint8Array(readFileSync(d))).header;
  const k = `${h.mapName}:${h.mapChecksum}`;
  versionOf.set(d, k);
  if (!perMap.has(k) || /hltv/i.test(d)) perMap.set(k, d);
}

describe.skipIf(mapDirs.length === 0 || demos.length === 0)('walkable-area map on real maps (plan 2.15)', () => {
  const maps = indexMaps(mapDirs);
  it.each([...perMap.values()].map((d) => [basename(d), d]))('%s', (_n, path) => {
    const demo = readDemo(new Uint8Array(readFileSync(path)));
    const name = demo.header.mapName.replace(/\.bsp$/i, '');
    const mm = matchMap(maps, name, demo.header.mapChecksum);
    if (mm.status !== 'ok' && mm.status !== 'renamed') return;
    const bsp = new Uint8Array(readFileSync(mm.file.path));
    const col = readCollision(bsp, readEntityList(bsp));
    const m = extractMatch(demo, { tracks: true, samplesPerSecond: 2 });
    const pts = (m.tracks ?? []).flatMap((t) => t.seen.filter((p) => p.alive));
    // 1. The game's collision agrees with where players were (rounded positions, standing or crouching).
    const fits = (x: number, y: number, z: number) =>
      [1, HULL_CROUCHING].some((h) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => [0, 1].some((dz) => !col.solid([x + dx, y + dy, z + dz], h))));
    const fit = pts.filter((p) => fits(p.x, p.y, p.z)).length;
    expect(fit / pts.length).toBeGreaterThan(0.985);
    // 2. The map plus the other demos of this map version covers where players stood in this one.
    const others = demos.filter((d) => d !== path && versionOf.get(d) === versionOf.get(path));
    const observations = others.flatMap((d) => observationsFrom(extractMatch(readDemo(new Uint8Array(readFileSync(d))), { tracks: true, samplesPerSecond: 10 }).tracks ?? []));
    const w = buildWalkMap(bsp, { observations });
    let ground = 0, on = 0;
    for (const p of pts) {
      const f = feetAt(col, [p.x, p.y, p.z]);
      if (!f) continue;
      ground++;
      const k = nearestNode(w, [p.x, p.y, f.z], 1, false);
      if (k !== undefined && Math.abs(w.nodes[k].z - f.z) < 40) on++;
    }
    expect(on / ground).toBeGreaterThan(0.97);
    // 3. Every bomb site can be walked to from the T spawn, in a believable time (8–30 s at 250 units/s).
    const facts = readMapFacts(bsp);
    const sites = applySiteLetters(facts.bombSites, name, demo.header.mapChecksum);
    expect(new Set(sites.map((s) => s.letter))).toEqual(new Set(['A', 'B']));
    const t = facts.spawnsT[0];
    const start = nearestNode(w, t, 3);
    expect(start).toBeDefined();
    const r = shortestFrom(w, start!);
    for (const s of sites) {
      let best = Infinity;
      w.nodes.forEach((n, i) => {
        const q = nodePos(n);
        if (q[0] >= s.mins[0] && q[0] <= s.maxs[0] && q[1] >= s.mins[1] && q[1] <= s.maxs[1] && q[2] >= s.mins[2] - 64 && q[2] <= s.maxs[2] + 64) best = Math.min(best, r.cost[i]);
      });
      expect(best / 250).toBeGreaterThan(8);
      expect(best / 250).toBeLessThan(30);
    }
  });
});
