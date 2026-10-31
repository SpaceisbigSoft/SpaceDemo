// 5.j radar replay (step 1): one round's positions by source, and what the map shows at a moment (no demos needed),
// plus a Set 1 check when CDF_ZIPS and CDF_MAPS are set.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MatchData, TrackPoint } from '../../engine/src/match/types.js';
import { readDetails, readReplay } from '../main/details.js';
import { heatmapAndProjection } from '../main/heatmap.js';
import { findCandidates } from '../main/library.js';
import { replayData } from '../main/replay.js';
import { playerAt } from '../renderer/pages/DetailsReplay.js';

const pt = (time: number, x: number, y: number, alive = true, yaw?: number, weapon?: string): TrackPoint => ({ time, x, y, z: 0, alive, yaw, weapon });
const player = (id: number, name: string, team: 'T' | 'CT') => ({ id, slot: id, name, names: [name], team, isHltv: false, isRecorder: id === 1, shots: {} });
const m: MatchData = {
  map: 'de_test', recording: 'POV', restarts: 0, recorderId: 1,
  players: [player(1, 'Alpha', 'T'), player(2, 'Bravo', 'CT'), player(3, 'Charlie', 'T')],
  rounds: [
    { number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'CT', reason: 'eliminated' },
    { number: 2, start: 105, freezeEnd: 110, end: 200, winner: 'T', reason: 'eliminated' },
  ],
  kills: [{ time: 60, round: 1, killer: 2, victim: 1, headshot: false, weapon: 'm4a1', killerTeam: 'CT', victimTeam: 'T', teamKill: false, suicide: false }],
  deaths: [{ time: 64, round: 1, victim: 1, match: 'timing', model: 'terror', position: [100, 0, 0] }],
  chat: [], radio: [], voice: [], director: [],
  bomb: [{ time: 50, round: 1, kind: 'planted', position: [0, 0, 0] }, { time: 150, round: 2, kind: 'planted', position: [0, 0, 0] }],
  tracks: [
    { player: 1, seen: [pt(10, 0, 0, true, 90, 'ak47'), pt(10.5, 80, 0, true, 90, 'ak47'), pt(20, 0, 0, true, 0, 'knife'), pt(120, 0, 0)], radar: [], heard: [] },
    { player: 2, seen: [pt(30, 400, 0)], radar: [], heard: [{ ...pt(40, 500, 0), sound: 'step' }] },
    { player: 3, seen: [], radar: [pt(15, -200, 0)], heard: [] },
  ],
};
const project = (x: number, y: number): [number, number] => [512 + x / 8, 384 - y / 8];

describe('5.j radar replay', () => {
  const { data: heat } = heatmapAndProjection({ m, mapName: 'de_test', checksum: 0, overview: { project } });
  const r = replayData(m, project, heat.kills, 1);
  if ('error' in r) throw new Error(r.error);

  it('keeps one round, in picture pixels, with weapon changes and the view direction turned for the picture', () => {
    expect([r.start, r.end, r.freezeEnd]).toEqual([0, 105, 5]);
    const a = r.players.find((p) => p.name === 'Alpha')!;
    expect(a.seen).toEqual([10, 512, 384, 270, 1, 10.5, 522, 384, 270, 1, 20, 512, 384, 0, 1]); // round 2's point is left out
    expect(a.weapons).toEqual([[10, 'ak47'], [20, 'knife']]);
    expect(r.players.map((p) => p.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(r.bomb).toEqual([{ time: 50, kind: 'planted', x: 512, y: 384 }]);
    expect(r.kills).toHaveLength(1);
    expect(replayData(m, project, heat.kills, 9)).toEqual({ error: "There's no round 9 in this demo." });
  });

  it('shows each player by what the demo knows at that moment', () => {
    const at = (name: string, t: number) => playerAt(r.players.find((p) => p.name === name)!, t, r.kills);
    expect(at('Alpha', 10.25)).toMatchObject({ source: 'seen', x: 517, y: 384, dir: 270, weapon: 'ak47' }); // halfway
    expect(at('Alpha', 25)).toMatchObject({ source: 'last', age: 5, weapon: 'knife' });
    expect(at('Alpha', 40).source).toBe('unknown');
    expect(at('Alpha', 61)).toMatchObject({ source: 'dead', x: 524.5, y: 384 });
    expect(at('Charlie', 15.5).source).toBe('radar');
    expect(at('Bravo', 40.3)).toMatchObject({ source: 'heard', x: 574.5 });
  });
});

describe('5.j estimated positions', () => {
  const { data: heat } = heatmapAndProjection({ m, mapName: 'de_test', checksum: 0, overview: { project } });
  // No walk map: straight lines between known positions. Spawns: T at (0,0), CT at (800,0).
  const r = replayData(m, project, heat.kills, 1, { spawns: { T: [[0, 0, 0]], CT: [[800, 0, 0]] } });
  if ('error' in r) throw new Error(r.error);

  it('fills the gaps between known positions, with a radius and a confidence', () => {
    expect(r.estimates).toBe(true);
    expect(r.unitPx).toBe(0.125);
    const bravo = r.players.find((p) => p.name === 'Bravo')!;
    const now = playerAt(bravo, 35, r.kills, true);
    expect(now.source).toBe('estimated');
    // Between seen at (400,0) at 30 s and heard at (500,0) at 40 s: somewhere on the way, in pixels 562..574.5.
    expect(now.x!).toBeGreaterThan(562);
    expect(now.x!).toBeLessThan(574.5);
    expect(now.confidence!).toBeGreaterThan(40);
    expect(now.radius!).toBeGreaterThan(2);
    expect(now.route!.length).toBeGreaterThan(2);
    // After his last known position (heard at 40 s), held there with a growing radius.
    const later = playerAt(bravo, 60, r.kills, true);
    expect(later).toMatchObject({ source: 'estimated', held: true });
    expect(later.radius!).toBeGreaterThan(now.radius!);
    // Without estimates the same moment is "last seen" / "not known".
    expect(playerAt(bravo, 35, r.kills, false).source).toBe('last');
  });

  it('never estimates over a known position or after death', () => {
    const alpha = r.players.find((p) => p.name === 'Alpha')!;
    expect(playerAt(alpha, 10.25, r.kills, true).source).toBe('seen');
    expect(playerAt(alpha, 61, r.kills, true).source).toBe('dead');
    const est = alpha.est ?? [];
    for (let i = 0; i < est.length; i += 7) expect(est[i]).toBeLessThanOrEqual(60);
  });
});

const zips = process.env.CDF_ZIPS, maps = process.env.CDF_MAPS;
describe.skipIf(!zips || !maps)('5.j on Set 1', () => {
  it('modTside round 1: all 10 players, the recorder seen throughout, the plant on B', () => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === 'modTside')!;
    const mapFile = maps!.split(':').map((d) => join(d, 'de_train.bsp')).find(existsSync);
    const job = { key: 'modTside', file: c.file, zipEntry: c.zipEntry, mapFile, mapIsInstalled: false };
    const d = readDetails(job);
    if ('error' in d) throw new Error(d.error);
    const r = readReplay(job, 1);
    if ('error' in r) throw new Error(r.error);
    expect(r.players).toHaveLength(10);
    const rec = r.players.find((p) => p.recorder)!;
    expect(rec.name).toBe(':i69:Endbringer');
    // The recorder's own position is known all round until he dies (round 1: killed at 3:18 in the demo).
    const died = r.kills.find((k) => k.victim === rec.name)?.time ?? r.end;
    const times = rec.seen.filter((_, i) => i % 5 === 0).filter((x) => x <= died);
    expect(Math.max(...times.slice(1).map((x, i) => x - times[i]))).toBeLessThan(1);
    expect(r.bomb.find((b) => b.kind === 'planted')).toBeDefined();
    expect(r.kills).toHaveLength(6);
    // Estimated positions with the map: every enemy (not seen all the time) gets some.
    expect(r.estimates).toBe(true);
    expect(r.players.filter((p) => p.team === 'CT' && (p.est?.length ?? 0) > 0)).toHaveLength(5);
  }, 120_000);
});
