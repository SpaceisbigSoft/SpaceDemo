// 5.k heatmaps: positions turned into picture pixels, kill lines, plants by site, time spent (no demos needed),
// plus Set 1 checks when CDF_ZIPS and CDF_MAPS (folders with the .bsp files, ':'-separated) are set.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../../engine/src/container/read.js';
import { inspectParsed } from '../../engine/src/inspect.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import type { MatchData, TrackPoint } from '../../engine/src/match/types.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { fitProjection, HEAT_CELL, heatmapData } from '../main/heatmap.js';
import { findCandidates } from '../main/library.js';

const pt = (time: number, x: number, y: number, alive = true): TrackPoint => ({ time, x, y, z: 0, alive });
const player = (id: number, name: string, team: 'T' | 'CT') => ({ id, slot: id, name, names: [name], team, isHltv: false, isRecorder: false, shots: {} });

const m: MatchData = {
  map: 'de_test', recording: 'HLTV', restarts: 0,
  players: [player(1, 'Alpha', 'T'), player(2, 'Bravo', 'CT')],
  rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'T', reason: 'eliminated' }],
  kills: [
    { time: 50, round: 1, killer: 1, victim: 2, headshot: true, weapon: 'ak47', killerTeam: 'T', victimTeam: 'CT', teamKill: false, suicide: false },
    { time: 60, round: 1, killer: null, victim: 1, headshot: false, weapon: 'world', killerTeam: undefined, victimTeam: 'T', teamKill: false, suicide: false },
  ],
  deaths: [{ time: 54, round: 1, victim: 2, match: 'timing', model: 'gign', position: [1000, 0, 0] }],
  chat: [], radio: [], voice: [], director: [],
  bomb: [{ time: 40, round: 1, kind: 'planted', position: [0, 1000, 0] }],
  tracks: [
    { player: 1, seen: [pt(10, 0, 0), pt(10.2, 0, 0), pt(49.9, 0, 0), pt(59.5, -1000, 0)], radar: [], heard: [] },
    { player: 2, seen: [pt(20, 1000, 0)], radar: [], heard: [] },
  ],
};

describe('5.k heatmaps', () => {
  it('fits world bounds into the picture, north up', () => {
    const p = fitProjection(-1000, -1000, 1000, 1000, 0);
    expect(p(0, 0)).toEqual([512, 384]);
    expect(p(-1000, 1000)).toEqual([128, 0]);
    expect(p(1000, -1000)).toEqual([896, 768]);
  });

  it('draws kills from the killer to the body, with the distance', () => {
    const h = heatmapData({ m, mapName: 'de_test', checksum: 0 });
    expect(h.useMapPicture).toBe(false);
    expect(h.kills).toHaveLength(2);
    const [k, world] = h.kills;
    expect(k).toMatchObject({ killer: 'Alpha', victim: 'Bravo', victimFrom: 'corpse', killerFrom: 'seen', distance: 1000, killerTeam: 'T', victimTeam: 'CT' });
    expect(k.vx! - k.kx!).toBeGreaterThan(0); // victim east of the killer
    // Killed by the world: no killer position; the victim's last known position (no body) is used.
    expect(world).toMatchObject({ killer: 'the world', victimFrom: 'seen' });
    expect(world.kx).toBeUndefined();
  });

  it('places plants and counts time spent in half-second steps', () => {
    const h = heatmapData({ m, mapName: 'de_test', checksum: 0, overview: { project: (x, y) => [512 + x / 8, 384 - y / 8] } });
    expect(h.useMapPicture).toBe(true);
    expect(h.plants).toEqual([{ x: 512, y: 259, round: 1, time: 40, site: undefined }]);
    // Alpha: 10 and 10.2 fall in the same half-second → 1 count at (0,0); 49.9 → +1 there; 59.5 elsewhere.
    const cols = 1024 / HEAT_CELL;
    const centre = Math.floor(384 / HEAT_CELL) * cols + Math.floor(512 / HEAT_CELL);
    expect(h.heat.Alpha.cells.find(([i]) => i === centre)).toEqual([centre, 2, 1]);
    expect(h.heat.Alpha.team).toBe('T');
    expect(h.heat.Bravo.cells.reduce((a, [, n]) => a + n, 0)).toBe(1);
  });
});

const zips = process.env.CDF_ZIPS, maps = process.env.CDF_MAPS;
describe.skipIf(!zips || !maps)('5.k heatmaps on Set 1', () => {
  const bspFor = (name: string, crc: number) => {
    // An exact old version from a map pool (<crc>_<map>) first, then the game's own map.
    const dirs = maps!.split(':');
    return dirs.map((d) => join(d, `${crc}_${name}`, `${name}.bsp`)).find(existsSync) ?? dirs.map((d) => join(d, `${name}.bsp`)).find(existsSync);
  };
  it('POV and HLTV of the same half agree; plants fall on sites; most killers are placed', () => {
    const seen = new Set<string>();
    const demos = findCandidates([zips!]).candidates.filter((c) => !seen.has(c.name) && seen.add(c.name));
    const read = (name: string) => {
      const c = demos.find((x) => x.name === name)!;
      const bytes = readZipEntry(c.file, c.zipEntry!);
      const demo = readDemo(bytes);
      const r = inspectParsed(demo, bytes.length);
      const file = bspFor(r.mapName, r.mapChecksum);
      return heatmapData({ m: extractMatch(demo, { tracks: true }), mapName: r.mapName, checksum: r.mapChecksum, bsp: file ? new Uint8Array(readFileSync(file)) : undefined });
    };
    const pov = read('modTside'), hltv = read('MoD train T hltvdemo');
    expect(pov.plants.map((p) => p.site).join('')).toBe('BABAABABBB');
    expect(hltv.plants.map((p) => p.site).join('')).toBe('BABAABABBB');
    expect(hltv.kills.filter((k) => k.kx !== undefined).length).toBe(hltv.kills.length);
    expect(pov.kills.filter((k) => k.kx !== undefined).length / pov.kills.length).toBeGreaterThan(0.8);
    expect(pov.kills.filter((k) => k.victimFrom === 'corpse').length).toBeGreaterThanOrEqual(77);
    // An old map version: floor drawn from the map file, plants still on sites.
    const old = read('shebangTside');
    expect(old.floorPath?.length).toBeGreaterThan(1000);
    expect(old.plants.every((p) => p.site)).toBe(true);
  }, 120_000);
});
