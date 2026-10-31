// 5.q enemy sightings: sound kinds, what counts as in sight / heard (no demos needed), and the Set 1 check that the
// recorder's victims were in sight just before he killed them (CDF_ZIPS + CDF_MAPS).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Sight } from '../../engine/src/map/sight.js';
import type { MatchData, TrackPoint } from '../../engine/src/match/types.js';
import { readDetails } from '../main/details.js';
import { findCandidates } from '../main/library.js';
import { sightingsData, soundKind } from '../main/sightings.js';

const pt = (time: number, x: number, y: number, yaw?: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ time, x, y, z: 0, alive: true, yaw, ...extra });
const player = (id: number, name: string, team: 'T' | 'CT') => ({ id, slot: id, name, names: [name], team, isHltv: false, isRecorder: id === 1, shots: {} });
const project = (x: number, y: number): [number, number] => [512 + x / 8, 384 - y / 8];
// A wall at x = 500..600 (solid), everything else open.
const wall: Sight = {
  solid: (p) => p[0] >= 500 && p[0] <= 600,
  clear(a, b) { for (let i = 1; i < 50; i++) { const f = i / 50; if (this.solid([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0])) return false; } return true; },
};

const m: MatchData = {
  map: 'de_test', recording: 'POV', restarts: 0, recorderId: 1,
  players: [player(1, 'Me', 'T'), player(2, 'Enemy', 'CT'), player(3, 'Mate', 'T')],
  rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'T', reason: 'eliminated' }],
  kills: [{ time: 30, round: 1, killer: 1, victim: 2, headshot: false, weapon: 'ak47', killerTeam: 'T', victimTeam: 'CT', teamKill: false, suicide: false }],
  deaths: [], chat: [], radio: [], voice: [], bomb: [], director: [],
  tracks: [
    // The recorder stands at the origin looking east (yaw 0) all round.
    { player: 1, seen: Array.from({ length: 101 }, (_, i) => pt(i, 0, 0, 0)), radar: [], heard: [] },
    { player: 2, seen: [
      pt(10, 400, 0, 180, { weapon: 'm4a1' }), pt(10.5, 410, 0, 180, { weapon: 'm4a1', crouch: true }), // in view, in sight
      pt(15, 800, 0, 180), // behind the wall: in the view area only
      pt(20, -300, 0, 0), // behind the recorder: out of his field of view
      pt(29.5, 300, 0, 180, { weapon: 'm4a1' }),
    ], radar: [], heard: [
      { ...pt(8, 900, 0), sound: 'player/pl_step1' }, // within hearing range
      { ...pt(9, 2000, 0), sound: 'player/pl_step2' }, // too far
    ] },
  ],
};

describe('5.q enemy sightings', () => {
  it('sorts sounds by kind', () => {
    expect(['player/pl_dirt3', 'player/bhit_flesh-2', 'player/headshot1', 'player/die2', 'weapons/knife_deploy1', 'items/gunpickup2', 'common/null'].map(soundKind))
      .toEqual(['step', 'hit', 'hit', 'death', 'weapon', 'weapon', 'other']);
  });

  it('with the map: only in the field of view with a clear line; sounds only within hearing range', () => {
    const s = sightingsData(m, project, [], wall)!;
    expect(s).toMatchObject({ recorder: 'Me', team: 'T', method: 'sight' });
    const e = s.rounds[0].enemies.find((x) => x.name === 'Enemy')!;
    expect(e.seen.map((x) => [x.from, x.to, x.weapon, x.crouch])).toEqual([[10, 10.5, 'm4a1', 50], [29.5, 29.5, 'm4a1', 0]]);
    expect(e.sounds.map((x) => [x.time, x.kind])).toEqual([[8, 'step']]);
    expect(e.died).toBe(30);
    expect(s.rounds[0].firstContact).toMatchObject({ time: 8, name: 'Enemy', how: 'heard', sound: 'step' });
  });

  it('without the map: everything the server sent counts (view area)', () => {
    const s = sightingsData(m, project)!;
    expect(s.method).toBe('view-area');
    expect(s.rounds[0].enemies[0].seen.length).toBe(4);
    expect(sightingsData({ ...m, recording: 'HLTV' }, project)).toBeUndefined();
  });
});

const zips = process.env.CDF_ZIPS, maps = process.env.CDF_MAPS;
describe.skipIf(!zips || !maps)('5.q on Set 1', () => {
  it("the recorder's victims were in sight just before each kill (modTside, modCTside)", () => {
    const cands = findCandidates([zips!]).candidates;
    const mapFile = maps!.split(':').map((d) => join(d, 'de_train.bsp')).find(existsSync);
    for (const name of ['modTside', 'modCTside']) {
      const c = cands.find((x) => x.name === name)!;
      const d = readDetails({ key: name, file: c.file, zipEntry: c.zipEntry, mapFile, mapIsInstalled: false });
      if ('error' in d) throw new Error(d.error);
      const s = d.sightings!;
      expect(s.method).toBe('sight');
      const kills = d.heatmap.kills.filter((k) => k.killer === s.recorder && !k.teamKill);
      expect(kills.length).toBeGreaterThan(10);
      for (const k of kills) {
        const e = s.rounds.find((x) => x.round === k.round)?.enemies.find((x) => x.name === k.victim);
        expect(e?.seen.some((sp) => k.time >= sp.from - 0.3 && k.time - sp.to <= 1), `${name} round ${k.round} ${k.victim}`).toBe(true);
      }
    }
  }, 300_000);
});
