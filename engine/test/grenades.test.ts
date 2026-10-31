// 5.w grenade throws: the thrower is the player who had that grenade in hand where it was first seen, with the grenade
// flying away from him (made-up data); on Set 1 a player's demo names the same thrower as the HLTV demo (CDF_DEMOS).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { alignMatches, toBase } from '../src/match/combine.js';
import { extractMatch } from '../src/match/extract.js';
import { grenadeThrows } from '../src/match/grenades.js';
import type { MatchData, TrackPoint } from '../src/match/types.js';
import { fixtureDemos } from './fixtures.js';

const pt = (time: number, x: number, weapon?: string): TrackPoint => ({ time, x, y: 0, z: 0, alive: true, weapon });
const pl = (id: number, name: string) => ({ id, slot: id, name, names: [name], team: 'T' as const, isHltv: false, isRecorder: false, shots: {} });

describe('5.w grenade throws', () => {
  const m: MatchData = {
    map: 'de_test', recording: 'HLTV', restarts: 0, chat: [], radio: [], bomb: [], voice: [], director: [], deaths: [], kills: [],
    players: [pl(1, 'holder'), pl(2, 'closer'), pl(3, 'behind')],
    rounds: [{ number: 1, start: 0, end: 100, winner: 'T' }],
    tracks: [
      { player: 1, seen: [pt(9.5, 0, 'hegrenade'), pt(10, 0, 'hegrenade')], radar: [], heard: [] },
      { player: 2, seen: [pt(10, 15, 'ak47')], radar: [], heard: [] },
      { player: 3, seen: [pt(10, 300, 'knife')], radar: [], heard: [] },
    ],
    grenades: [
      { kind: 'he', points: [{ time: 10, x: 20, y: 0, z: 0 }, { time: 10.1, x: 40, y: 0, z: 0 }, { time: 11.5, x: 400, y: 0, z: 0 }] },
      // A smoke first seen far from everyone: thrower unknown; it lies where it stopped moving.
      { kind: 'smoke', points: [{ time: 20, x: 1000, y: 0, z: 0 }, { time: 21, x: 1200, y: 0, z: 0 }, { time: 30, x: 1201, y: 0, z: 0 }, { time: 40, x: 1201, y: 0, z: 0 }] },
    ],
  };
  it('names the player with that grenade in hand, and leaves far ones unknown', () => {
    const g = grenadeThrows(m);
    expect(g.map((x) => [x.kind, x.thrower, x.round, x.to[0], x.flight])).toEqual([['he', 1, 1, 400, 1.5], ['smoke', undefined, 1, 1200, 1]]);
  });
});

const demos = fixtureDemos();
describe.skipIf(demos.length === 0)('5.w on Set 1 (CDF_DEMOS)', () => {
  it('HLTV demos name the thrower of 97 %+ of throws; player demos agree with them on 95 %+ of the throws both name', () => {
    const dir = (f: string) => demos.find((d) => d.endsWith(f))!;
    let same = 0, diff = 0;
    for (const [pov, hltv] of [['modTside.dem', 'MoD train T hltvdemo.dem'], ['modCTside.dem', 'MoD train CT hltvdemo.dem'], ['shebangTside.dem', 'hltvtside.dem'], ['shebangCTside.dem', 'hltvctside.dem']]) {
      const P = extractMatch(readDemo(readFileSync(dir(pov))), { tracks: true });
      const H = extractMatch(readDemo(readFileSync(dir(hltv))), { tracks: true });
      const al = alignMatches(P, H)!;
      const gp = grenadeThrows(P), gh = grenadeThrows(H).map((g) => ({ ...g, time: toBase(al, g.time) }));
      expect(gh.filter((g) => g.thrower !== undefined).length / gh.length, hltv).toBeGreaterThan(0.97);
      const name = (m: MatchData, id?: number) => m.players.find((p) => p.id === id)?.name;
      for (const g of gp) {
        const h = gh.find((x) => x.kind === g.kind && Math.abs(x.time - g.time) < 1 && Math.hypot(x.to[0] - g.to[0], x.to[1] - g.to[1]) < 100);
        if (!h || g.thrower === undefined || h.thrower === undefined) continue;
        if (name(P, g.thrower) === name(H, h.thrower)) same++; else diff++;
      }
    }
    expect(same).toBeGreaterThan(120);
    expect(same / (same + diff)).toBeGreaterThan(0.95);
  }, 300_000);
});
