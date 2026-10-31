// 5.r Combine demos of the same match: lining up two recordings' clocks on the kill feed, adding positions, telling
// the other half of a match. Made-up matches here; with CDF_DEMOS also every pair of Set 1 recordings.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { alignMatches, mergeMatches, otherHalf, positionCoverage, sameRounds, toBase } from '../src/match/combine.js';
import { extractMatch } from '../src/match/extract.js';
import type { Kill, MatchData, MatchPlayer, TrackPoint } from '../src/match/types.js';
import { fixtureDemos } from './fixtures.js';

const NAMES = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5'];
const player = (id: number, name: string, team: 'T' | 'CT'): MatchPlayer => ({ id, slot: id, name, names: [name], team, isHltv: false, isRecorder: false, shots: {} });
const pt = (time: number, x: number, y = 0): TrackPoint => ({ time, x, y, z: 0, alive: true });

/** A made-up half: 12 rounds of 100 s, 3 kills each, every player at x = 10 * id; `shift` moves the clock, `ids`
 *  renumbers the players (another recording), `swap` swaps the teams' sides (the other half). */
function half({ shift = 0, idBase = 1, swap = false, jumpAt = Infinity, jump = 0, positions = true } = {}): MatchData {
  const players = NAMES.map((n, i) => player(idBase + i, n, (i < 5) !== swap ? 'T' : 'CT'));
  const t = (x: number) => x + shift + (x >= jumpAt ? jump : 0);
  const rounds = Array.from({ length: 12 }, (_, r) => ({ number: r + 1, start: t(r * 100), freezeEnd: t(r * 100 + 5), end: t(r * 100 + 90), winner: (r % 3 ? 'T' : 'CT') as 'T' | 'CT' }));
  const kills: Kill[] = [];
  for (let r = 0; r < 12; r++) {
    for (let k = 0; k < 3; k++) {
      const killer = players[(r + k) % 5], victim = players[5 + ((r + 2 * k) % 5)];
      kills.push({ time: t(r * 100 + 20 + 10 * k), round: r + 1, killer: killer.id, victim: victim.id, headshot: false, weapon: k ? 'ak47' : 'm4a1', teamKill: false, suicide: false });
    }
  }
  return {
    map: 'de_test', recording: 'HLTV', restarts: 0, players, rounds, kills, deaths: [], chat: [], radio: [], bomb: [], voice: [], director: [],
    tracks: positions ? players.map((p) => ({ player: p.id, seen: Array.from({ length: 12 }, (_, r) => pt(t(r * 100 + 10), 10 * (p.id - idBase))), radar: [], heard: [] })) : [],
    grenades: [],
  };
}

describe('5.r lining up recordings', () => {
  it('finds the clock offset from the kills, with every kill on time', () => {
    const base = half(), other = half({ shift: -806.52, idBase: 30 });
    const al = alignMatches(base, other)!;
    expect(al.offset).toBeCloseTo(806.52, 6);
    expect(al.consistent).toBe(36);
    expect(al.maxGap).toBeLessThan(1e-6);
    expect(al.roundEnds).toBe(12);
    expect(sameRounds(al)).toBe(true);
  });

  it('follows a clock jump in one recording round by round', () => {
    const base = half(), other = half({ shift: 4.53, idBase: 30, jumpAt: 1000, jump: -0.63 });
    const al = alignMatches(base, other)!;
    expect(al.maxGap).toBeLessThan(1e-6);
    expect(toBase(al, 4.53 + 1050 - 0.63)).toBeCloseTo(1050, 6);
    expect(toBase(al, 4.53 + 150)).toBeCloseTo(150, 6);
  });

  it("doesn't pair recordings of different matches, and tells the other half", () => {
    const base = half();
    const otherMatch = half();
    otherMatch.kills = otherMatch.kills.map((k, i) => ({ ...k, weapon: i % 2 ? 'awp' : 'deagle' }));
    expect(alignMatches(base, otherMatch)).toBeUndefined();
    const second = half({ swap: true });
    second.kills = second.kills.map((k) => ({ ...k, killer: k.victim, victim: k.killer! }));
    expect(sameRounds(alignMatches(base, second))).toBe(false);
    expect(otherHalf(base, second)).toBe(true);
    expect(otherHalf(base, half({ idBase: 30 }))).toBe(false);
  });

  it('adds the other recording\'s positions in this clock, by player name, once', () => {
    const base = half({ positions: false });
    base.tracks = base.players.slice(0, 5).map((p) => ({ player: p.id, seen: [pt(10, 0)], radar: [], heard: [] }));
    const other = half({ shift: -100, idBase: 30 });
    const al = alignMatches(base, other)!;
    const { m, added } = mergeMatches(base, [{ m: other, align: al }]);
    // a1 already had a point at 10 s: the other recording's copy isn't added twice.
    const a1 = m.tracks!.find((t) => t.player === base.players[0].id)!;
    expect(a1.seen.map((p) => p.time)).toEqual([10, ...Array.from({ length: 11 }, (_, r) => (r + 1) * 100 + 10)]);
    expect(added[0].newPlayers.sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(m.players).toHaveLength(10);
    // The inputs are unchanged.
    expect(base.tracks[0].seen).toHaveLength(1);
    expect(positionCoverage(m).share).toBeGreaterThan(positionCoverage(base).share);
  });
});

const demos = fixtureDemos();
describe.skipIf(demos.length === 0)('5.r on Set 1 (CDF_DEMOS)', () => {
  it('every POV/HLTV pair of the same half lines up within 0.5 s on all kills; nothing else pairs up', () => {
    const ms = demos.map((f) => ({ name: basename(f, '.dem'), m: extractMatch(readDemo(readFileSync(f))) }));
    const pairs: string[] = [];
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const al = alignMatches(ms[i].m, ms[j].m);
        if (!sameRounds(al)) continue;
        pairs.push([ms[i].name, ms[j].name].sort().join(' + '));
        expect(al!.maxGap, `${ms[i].name} + ${ms[j].name}`).toBeLessThanOrEqual(0.5);
        expect(al!.consistent).toBe(Math.min(ms[i].m.kills.length, ms[j].m.kills.length));
      }
    }
    expect(pairs.sort()).toEqual(['MoD train CT hltvdemo + modCTside', 'MoD train T hltvdemo + modTside', 'hltvctside + shebangCTside', 'hltvtside + shebangTside']);
  }, 600_000);
});
