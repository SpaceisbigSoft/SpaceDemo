// 5.s line of sight between players: field of view, walls, who saw first, kills through walls and from behind
// (made-up map stand-in); on Set 1 de_train (CDF_DEMOS + CDF_MAPS) most kills have a clear line, and a player's demo
// and the HLTV demo of the same half mostly name the same kills as having none.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { extractMatch } from '../src/match/extract.js';
import { canSee, sightlines } from '../src/match/sightlines.js';
import { readSight, type Sight } from '../src/map/sight.js';
import type { Kill, TrackPoint } from '../src/match/types.js';
import { fixtureDemos } from './fixtures.js';

// A wall: the plane x = 500 is solid for y < 0.
const wall: Sight = {
  solid: (p) => Math.abs(p[0] - 500) < 8 && p[1] < 0,
  clear(a, b, step = 8) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i < n; i++) { const f = i / n; if (this.solid([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])) return false; }
    return true;
  },
};
const pt = (time: number, x: number, y: number, yaw: number): TrackPoint => ({ time, x, y, z: 0, yaw, alive: true });

describe('5.s sight lines', () => {
  it('needs the target in the view and nothing solid in between', () => {
    expect(canSee(wall, { x: 0, y: 100, z: 0, yaw: 0 }, { x: 1000, y: 100, z: 0 })).toBe(true);
    expect(canSee(wall, { x: 0, y: 100, z: 0, yaw: 180 }, { x: 1000, y: 100, z: 0 })).toBe(false); // behind him
    expect(canSee(wall, { x: 0, y: -100, z: 0, yaw: 0 }, { x: 1000, y: -100, z: 0 })).toBe(false); // the wall
  });
  it('finds who saw first, and a kill from behind', () => {
    // Player 1 (T) at x 0 looks along +x from t = 10; player 2 (CT) at x 1000 faces away (+x) and turns at 11.
    const tracks = [
      { player: 1, seen: Array.from({ length: 31 }, (_, i) => pt(10 + i * 0.1, 0, 100, 0)), radar: [], heard: [] },
      { player: 2, seen: Array.from({ length: 31 }, (_, i) => pt(10 + i * 0.1, 1000, 100, 10 + i * 0.1 >= 12.5 ? 180 : 0)), radar: [], heard: [] },
    ];
    const kills: Kill[] = [{ time: 12, round: 1, killer: 1, victim: 2, headshot: false, weapon: 'ak47', teamKill: false, suicide: false }];
    const r = sightlines({ tracks, kills, rounds: [{ number: 1, start: 5, freezeEnd: 10, end: 13, winner: 'T' }], team: new Map([[1, 'T'], [2, 'CT']]), sight: wall });
    expect(r.firsts).toEqual([{ round: 1, time: 10, seer: 1, seen: 2, mutual: false }]);
    expect(r.kills[0]).toMatchObject({ known: true, clear: true, offView: 180, killerSaw: 2 });
    expect(r.kills[0].victimSaw).toBeUndefined();
  });
});

const demos = fixtureDemos();
const maps = (process.env.CDF_MAPS ?? '').split(':').filter(Boolean);
const trainMap = maps.map((d) => join(d, 'de_train.bsp')).find((f) => existsSync(f));
describe.skipIf(demos.length === 0 || !trainMap)('5.s on Set 1 de_train (CDF_DEMOS + CDF_MAPS)', () => {
  it('90 %+ of kills have a clear line; the player demos mostly agree with the HLTV demos on the ones that don\'t', () => {
    const sight = readSight(new Uint8Array(readFileSync(trainMap!)));
    const blocked = new Map<string, Set<string>>();
    for (const f of ['modTside.dem', 'modCTside.dem', 'MoD train T hltvdemo.dem', 'MoD train CT hltvdemo.dem']) {
      const file = demos.find((d) => basename(d) === f);
      if (!file) continue;
      const m = extractMatch(readDemo(new Uint8Array(readFileSync(file))), { tracks: true });
      const team = new Map<number, 'T' | 'CT'>();
      for (const k of m.kills) {
        if (k.killer !== null && (k.killerTeam === 'T' || k.killerTeam === 'CT')) team.set(k.killer, k.killerTeam);
        if (k.victimTeam === 'T' || k.victimTeam === 'CT') team.set(k.victim, k.victimTeam);
      }
      const r = sightlines({ tracks: m.tracks!, kills: m.kills, rounds: m.rounds, team, sight });
      const known = r.kills.filter((k) => k.known);
      expect(known.filter((k) => k.clear).length / known.length, f).toBeGreaterThan(0.9);
      const name = (id: number) => m.players.find((p) => p.id === id)?.name;
      blocked.set(f, new Set(known.filter((k) => !k.clear).map((k) => `${k.round} ${name(k.killer)}>${name(k.victim)}`)));
    }
    // Positions differ a little between recordings (the recorder's own exact view vs the HLTV's updates), so most —
    // not all — agree (measured 2026-10-31: 5 of 6).
    let agree = 0, all = 0;
    for (const [pov, hltv] of [['modTside.dem', 'MoD train T hltvdemo.dem'], ['modCTside.dem', 'MoD train CT hltvdemo.dem']]) {
      if (!blocked.has(pov) || !blocked.has(hltv)) continue;
      for (const k of blocked.get(pov)!) { all++; if (blocked.get(hltv)!.has(k)) agree++; }
    }
    if (all) expect(agree / all).toBeGreaterThanOrEqual(0.75);
  }, 300_000);
});
