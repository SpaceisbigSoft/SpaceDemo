import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectDemo } from '../src/inspect.js';
import { matchMap, type MapFile } from '../src/map-index.js';
import { fixtureDemos } from './fixtures.js';

describe('matchMap', () => {
  const maps: MapFile[] = [
    { path: 'a/de_nuke.bsp', name: 'de_nuke', checksum: 2537589255 },
    { path: 'old/de_nuke.bsp', name: 'de_nuke', checksum: 127948090 },
    { path: 'a/de_cpl_mill.bsp', name: 'de_cpl_mill', checksum: 1979151874 },
    { path: 'a/de_train.bsp', name: 'de_train', checksum: 3631264936 },
  ];
  it('finds the exact version even when a newer one has the same name', () => {
    expect(matchMap(maps, 'de_nuke', 127948090)).toEqual({ status: 'ok', file: maps[1] });
  });
  it('finds a renamed map by checksum', () => {
    expect(matchMap(maps, 'de_clan1_mill', 1979151874)).toEqual({ status: 'renamed', file: maps[2] });
  });
  it('reports a wrong version', () => {
    expect(matchMap(maps, 'de_train', 1)).toEqual({ status: 'wrongVersion', installed: [maps[3]] });
  });
  it('reports a missing map', () => {
    expect(matchMap(maps, 'de_aztec', 1).status).toBe('missing');
  });
});

const demos = fixtureDemos();

describe.skipIf(demos.length === 0)('inspector on real demos (CDF_DEMOS)', () => {
  it.each(demos.map((d) => [basename(d), d]))('%s', (_name, path) => {
    const r = inspectDemo(new Uint8Array(readFileSync(path)));
    expect(r.problems).toEqual([]);
    expect(r.magic).toBe('HLDEMO');
    expect(r.maps.length).toBeGreaterThan(0);
    for (const m of r.maps) expect(m).not.toMatch(/maps\/|\.bsp/i);
    expect(r.seconds).toBeGreaterThan(0);
    for (const s of r.sections) if (s.directoryFrames !== undefined) expect(s.netFrames).toBe(s.directoryFrames);
    if (r.recording === 'POV') expect(r.players.filter((p) => p.isRecorder)).toHaveLength(1);
    if (r.voiceCodec === 'voice_miles') {
      const talkers = r.players.filter((p) => p.voicePackets > p.emptyVoicePackets);
      for (const p of talkers) {
        expect(p.voiceSeconds).toBeGreaterThan(0);
        expect(p.talkBursts).toBeGreaterThan(0);
      }
    }
  });
});
