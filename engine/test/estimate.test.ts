import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { extractMatch } from '../src/match/extract.js';
import { estimateLife, estimateMatch, livesOf, WEAPON_SPEED, type Anchor } from '../src/match/estimate.js';
import { readMapFacts } from '../src/map/bsp.js';
import { buildWalkMap, observationsFrom } from '../src/map/walk.js';
import { indexMaps, matchMap } from '../src/map-index.js';
import { fixtureDemos } from './fixtures.js';

const seen = (time: number, x: number, y = 0, weapon = 'knife'): Anchor => ({ time, pos: [x, y, 0], kind: 'seen', accuracy: 2, weapon });

describe('position estimates (no map)', () => {
  it('moves evenly along a short gap and keeps sightings exact', () => {
    const est = estimateLife(undefined, { start: 0, end: 2, anchors: [seen(0, 0), seen(2, 400)] }, { step: 0.5 });
    expect(est.map((e) => e.source)).toEqual(['seen', 'estimated', 'estimated', 'estimated', 'seen']);
    expect(est[2].x).toBeCloseTo(200, 0);
    // Uncertainty grows away from sightings and shrinks again.
    expect(est[2].radius).toBeGreaterThan(est[1].radius);
    expect(est[3].radius).toBeCloseTo(est[1].radius, 0);
    expect(est[2].confidence).toBeLessThan(est[1].confidence);
  });
  it('in long gaps goes first, then waits (Set 1: players move, then hold a spot)', () => {
    const est = estimateLife(undefined, { start: 0, end: 40, anchors: [seen(0, 0), seen(40, 1000)] }, { step: 1 });
    const at20 = est.find((e) => e.time === 20)!;
    expect(at20.x).toBeGreaterThan(500); // further than an even spread would put him
  });
  it('flags gaps that cannot be walked in the time', () => {
    const est = estimateLife(undefined, { start: 0, end: 1, anchors: [seen(0, 0), seen(1, 2000)] }, { step: 0.25 });
    expect(est.some((e) => e.impossible)).toBe(true);
    expect(WEAPON_SPEED.awp).toBe(210);
  });
  it('holds the last known spot after the last sighting, with growing uncertainty', () => {
    const est = estimateLife(undefined, { start: 0, end: 10, anchors: [seen(0, 100)] }, { step: 1 });
    expect(est.slice(1).every((e) => e.source === 'held' && e.x === 100)).toBe(true);
    expect(est[9].radius).toBeGreaterThan(est[2].radius);
  });
  it('builds lives per round: spawn during freeze time, death at the kill, nothing for connections without evidence', () => {
    const data = {
      rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 60 }, { number: 2, start: 65, freezeEnd: 70, end: 120 }],
      kills: [{ time: 30, victim: 7 }],
      deaths: [{ time: 34, victim: 7, position: [500, 0, 0] as [number, number, number] }],
      track: { seen: [{ time: 20, x: 300, y: 0, z: 0, alive: true }], radar: [], heard: [] },
      spawns: [[0, 0, 0], [64, 0, 0]] as [number, number, number][],
    };
    const lives = livesOf(7, data);
    expect(lives.length).toBe(2);
    expect(lives[0].end).toBe(30);
    expect(lives[0].anchors.map((a) => a.kind)).toEqual(['spawn', 'spawn', 'seen', 'death']);
    expect(livesOf(8, { ...data, kills: [], track: { seen: [], radar: [], heard: [] } })).toEqual([]);
    expect(livesOf(7, { ...data, leftAt: 62 }).length).toBe(1);
  });
});

// Real demos: estimate a POV demo and check it against the HLTV recording of the same half (Set 1 MoD train T).
const mapDirs = (process.env.CDF_MAPS ?? '').split(/[:;]/).filter(Boolean);
const demos = fixtureDemos();
const povPath = demos.find((d) => /modTside\.dem$/i.test(d)), hltvPath = demos.find((d) => /MoD train T hltvdemo\.dem$/i.test(d));
describe.skipIf(!povPath || !hltvPath || mapDirs.length === 0)('position estimates vs HLTV truth (Set 1 MoD train, T half)', () => {
  it('estimates are close where sightings are close, and the radius covers ~80 %', () => {
    const pov = extractMatch(readDemo(new Uint8Array(readFileSync(povPath!))), { tracks: true });
    const hltvDemo = readDemo(new Uint8Array(readFileSync(hltvPath!)));
    const hl = extractMatch(hltvDemo, { tracks: true });
    // Clock offset from matching kills (killer + victim names).
    const nameP = (id: number | null) => pov.players.find((p) => p.id === id)?.name, nameH = (id: number | null) => hl.players.find((p) => p.id === id)?.name;
    const offs = pov.kills.map((k) => { const m = hl.kills.find((h) => nameH(h.killer) === nameP(k.killer) && nameH(h.victim) === nameP(k.victim) && h.weapon === k.weapon); return m ? m.time - k.time : NaN; }).filter(Number.isFinite).sort((a, b) => a - b);
    const off = offs[Math.floor(offs.length / 2)];
    const mm = matchMap(indexMaps(mapDirs), pov.map, hltvDemo.header.mapChecksum);
    expect(mm.status === 'ok' || mm.status === 'renamed').toBe(true);
    const bsp = new Uint8Array(readFileSync((mm as { file: { path: string } }).file.path));
    const facts = readMapFacts(bsp);
    const walk = buildWalkMap(bsp, { observations: observationsFrom(pov.tracks ?? []) });
    const est = estimateMatch(pov, { T: facts.spawnsT, CT: facts.spawnsCT }, walk);
    const errs: { err: number; radius: number }[] = [];
    for (const [id, points] of est) {
      const p = pov.players.find((x) => x.id === id)!;
      if (p.isRecorder) continue;
      const truth = (hl.tracks ?? []).filter((t) => nameH(t.player) === p.name).flatMap((t) => t.seen.filter((s) => s.alive)).sort((a, b) => a.time - b.time);
      let j = 0;
      for (const e of points) {
        if (e.source !== 'estimated') continue;
        const t = e.time + off;
        while (j + 1 < truth.length && truth[j + 1].time <= t) j++;
        if (!truth[j] || Math.abs(truth[j].time - t) > 0.15) continue;
        errs.push({ err: Math.hypot(truth[j].x - e.x, truth[j].y - e.y), radius: e.radius });
      }
    }
    expect(errs.length).toBeGreaterThan(2000);
    const sorted = errs.map((e) => e.err).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(200); // Set 1 run: ~107
    const within = errs.filter((e) => e.err <= e.radius).length / errs.length;
    expect(within).toBeGreaterThan(0.65);
    expect(within).toBeLessThan(0.95);
  });
});
