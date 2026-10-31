// 5.u recorder aim coaching: aim angles, appearances, reaction to the first shot and shots while moving (made-up data);
// on Set 1 the recorder's kill shots point at the victim's head (checks the view-angle layout and pitch sign), and every
// POV demo gives appearances, reactions and classified shots (CDF_DEMOS).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { extractMatch } from '../src/match/extract.js';
import { aimCoaching, aimError, aimSummary, shotWeapon, DRAW_DELAY } from '../src/match/aim.js';
import type { AimData, ViewSample } from '../src/match/types.js';
import { fixtureDemos } from './fixtures.js';

const view = (time: number, yaw: number, extra: Partial<ViewSample> = {}): ViewSample => ({
  time, pitch: 0, yaw, eye: [0, 0, 17], speed: 0, onGround: true, duck: false, attack: false, alive: true, ...extra,
});

describe('5.u aim maths', () => {
  it('measures the angle from the crosshair to a point (pitch + = looking down)', () => {
    const v = view(0, 0);
    expect(aimError(v, [100, 0, 17]).total).toBeCloseTo(0, 5);
    const right = aimError(v, [100, -100, 17]);
    expect(right.total).toBeCloseTo(45, 3);
    expect(right.h).toBeCloseTo(45, 3); // y negative = to the right when facing +x
    const up = aimError(v, [100, 0, 117]);
    expect(up.v).toBeCloseTo(45, 3);
    expect(aimError({ ...v, pitch: 45 }, [100, 0, -83]).total).toBeCloseTo(0, 3); // looking down 45°
  });
  it('names weapons from fire events', () => {
    expect([shotWeapon('ak47'), shotWeapon('mp5n'), shotWeapon('elite_left'), shotWeapon('knife'), shotWeapon('createsmoke')]).toEqual(['ak47', 'mp5navy', 'elite', undefined, undefined]);
  });
});

describe('5.u coaching on made-up data', () => {
  // Recorder at the origin looking along +x (yaw 0). The enemy steps out at x = 500 at t = 10 (2° to the right of the
  // crosshair, head height level), and the recorder shoots at 10.4 while still; later he runs and shoots, then jumps.
  const frames: ViewSample[] = [];
  for (let t = 5; t <= 20.001; t += 0.05) frames.push(view(Math.round(t * 1000) / 1000, 0, t > 15 ? { speed: 250 } : {}));
  frames.forEach((f) => { if (f.time >= 18) f.onGround = false; });
  const enemy: number[] = [];
  for (let t = 10; t <= 12.001; t += 0.05) enemy.push(Math.round(t * 1000) / 1000, 500, -17.5, 0, 0);
  const aim: AimData = { view: frames, shots: [{ time: 10.4, weapon: 'ak47' }, { time: 16, weapon: 'ak47' }, { time: 16.2, weapon: 'mp5n' }, { time: 18.5, weapon: 'usp' }, { time: 19, weapon: 'knife' }], players: [{ player: 2, points: enemy }] };
  const rep = aimCoaching({ aim, rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 30, winner: 'CT' }], kills: [{ time: 10.6, round: 1, killer: 1, victim: 2, headshot: true, weapon: 'ak47', teamKill: false, suicide: false }], recorder: [1], enemies: [2] });
  it('finds one appearance with its crosshair placement, reaction and outcome', () => {
    expect(rep.engagements).toHaveLength(1);
    const e = rep.engagements[0];
    expect(e.time).toBe(10);
    expect(e.crosshair).toBeCloseTo(2, 0);
    expect(e.crossH).toBeGreaterThan(0); // to the right
    expect(e.reaction).toBeCloseTo(0.4 - DRAW_DELAY, 5);
    expect(e.outcome).toBe('won');
    expect(rep.updateInterval).toBe(0.05);
  });
  it('classifies shots by the weapon’s accurate speed and by being in the air', () => {
    expect(rep.shots.map((s) => [s.weapon, s.state])).toEqual([['ak47', 'accurate'], ['ak47', 'moving'], ['mp5navy', 'accurate'], ['usp', 'air']]);
    expect(aimSummary(rep.engagements, rep.shots)).toMatchObject({ engagements: 1, reactions: 1, accurate: 2, moving: 1, air: 1 });
  });
});

const demos = fixtureDemos();
describe.skipIf(demos.length === 0)('5.u on Set 1 (CDF_DEMOS)', () => {
  const pov = demos.filter((d) => !/hltv/i.test(basename(d)));
  it('kill shots point at the victim\'s head (median under 4°, far better than with the pitch sign flipped), and POV demos give appearances, reactions and shots', () => {
    let checked = 0;
    const allErrs: number[] = [], allFlipped: number[] = [];
    for (const file of pov) {
      const m = extractMatch(readDemo(new Uint8Array(readFileSync(file))), { aim: true });
      if (m.recording !== 'POV' || !m.aim || m.recorderId === undefined) continue;
      const rec = m.players.find((p) => p.id === m.recorderId)!;
      const recIds = m.players.filter((p) => p.name === rec.name).map((p) => p.id);
      const pts = new Map(m.aim.players.map((p) => [p.player, p.points]));
      const errs: number[] = [], flipped: number[] = [];
      for (const k of m.kills) {
        if (k.killer === null || !recIds.includes(k.killer) || !pts.has(k.victim)) continue;
        const s = [...m.aim.shots].reverse().find((x) => x.time <= k.time + 0.02 && shotWeapon(x.weapon));
        if (!s || k.time - s.time > 0.5) continue;
        const v = [...m.aim.view].reverse().find((x) => x.time <= s.time + 0.03);
        const p = pts.get(k.victim)!;
        let b = -1;
        for (let i = 0; i < p.length; i += 5) if (p[i] <= s.time) b = i; else break;
        if (!v || b < 0) continue;
        const h: [number, number, number] = [p[b + 1], p[b + 2], p[b + 3] + (p[b + 4] ? 12 : 17)];
        errs.push(aimError(v, h).total);
        flipped.push(aimError({ ...v, pitch: -v.pitch }, h).total);
      }
      if (errs.length < 5) continue;
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
      // Sprays carry recoil, so a few degrees; with the pitch sign the other way round it is far worse.
      expect(med(errs), basename(file)).toBeLessThan(4);
      allErrs.push(...errs);
      allFlipped.push(...flipped);
      const enemies = m.players.filter((p) => (p.team === 'T' || p.team === 'CT') && p.team !== rec.team).map((p) => p.id);
      const rep = aimCoaching({ aim: m.aim, rounds: m.rounds, kills: m.kills, recorder: recIds, enemies });
      const sum = aimSummary(rep.engagements, rep.shots);
      expect(sum.engagements, basename(file)).toBeGreaterThan(5);
      expect(sum.reactions, basename(file)).toBeGreaterThan(0);
      expect(sum.shots, basename(file)).toBeGreaterThan(10);
      expect(rep.updateInterval).toBeGreaterThan(0.02);
      expect(rep.updateInterval).toBeLessThan(0.1);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
    // Over all kill shots (a level shot looks the same either way, so per demo this can be close).
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(allErrs) * 2).toBeLessThan(mean(allFlipped));
  }, 600_000);
});
