import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { checkMatch, extractMatch } from '../src/match/extract.js';
import { PayloadReader } from '../src/match/payload.js';
import { fixtureDemos } from './fixtures.js';

describe('PayloadReader', () => {
  it('reads little-endian numbers, coords and strings', () => {
    const r = new PayloadReader(new Uint8Array([0xff, 0xff, 0x10, 0x00, 0x41, 0x42, 0x00, 0x2a, 0x00, 0x00, 0x00]));
    expect(r.i16()).toBe(-1);
    expect(r.coord()).toBe(2);
    expect(r.str()).toBe('AB');
    expect(r.i32()).toBe(42);
  });
  it('returns 0 and "" past the end instead of throwing', () => {
    const r = new PayloadReader(new Uint8Array([1]));
    expect(r.u8()).toBe(1);
    expect(r.u8()).toBe(0);
    expect(r.str()).toBe('');
    expect(r.remaining).toBe(0);
  });
});

const demos = fixtureDemos();

describe.skipIf(demos.length === 0)('match data on real demos (CDF_DEMOS)', () => {
  it.each(demos.map((d) => [basename(d), d]))('%s', (_name, path) => {
    const m = extractMatch(readDemo(new Uint8Array(readFileSync(path))));
    const c = checkMatch(m);
    // Kills counted from the kill feed equal the server's own final frags for every player.
    expect(c.fragMismatches).toEqual([]);
    // Rounds won equal the server's team score; HLTV recordings may miss score updates or start mid-match.
    if (m.recording === 'POV') expect(c.roundsMatch).toBe(true);
    // Every kill refers to known players.
    const ids = new Set(m.players.map((p) => p.id));
    for (const k of m.kills) {
      expect(ids.has(k.victim)).toBe(true);
      if (k.killer !== null) expect(ids.has(k.killer)).toBe(true);
    }
    // Rounds are in order and complete.
    m.rounds.forEach((r, i) => {
      expect(r.number).toBe(i + 1);
      expect(r.end!).toBeGreaterThanOrEqual(r.start);
    });
    // Nearly every corpse is matched to its victim.
    if (m.deaths.length > 10) expect(m.deaths.filter((d) => d.victim !== undefined).length / m.deaths.length).toBeGreaterThan(0.95);
    // Recorder data only in POV demos.
    expect(m.recorder !== undefined).toBe(m.recording === 'POV');
  });
});
