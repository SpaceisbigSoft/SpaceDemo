import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { writeDemo } from '../src/container/write.js';
import { FrameType } from '../src/container/types.js';
import { upgradeTo48 } from '../src/transforms/upgrade-to-48.js';
import { fixtureDemos } from './fixtures.js';

/** Makes a "crashed" copy: no directory (offset 0) and the file cut off in the middle of a frame. */
function crash(bytes: Uint8Array, keep: number): Uint8Array {
  const out = bytes.slice(0, Math.floor(bytes.length * keep) + 3);
  new DataView(out.buffer).setUint32(540, 0, true);
  return out;
}

const demos = fixtureDemos();

describe.skipIf(demos.length === 0)('crashed-demo repair on real demos (plan 2.6)', () => {
  it.each(demos.map((d) => [d.split('/').pop()!, d]))('%s: cut at 60 %, no directory -> repaired, reads cleanly, converts', (_n, path) => {
    const original = readDemo(new Uint8Array(readFileSync(path)));
    const crashed = readDemo(crash(new Uint8Array(readFileSync(path)), 0.6));
    expect(crashed.recovered).toBe(true);
    expect(crashed.sections.length).toBe(2);

    // Same split as the original: the LOADING section is identical, playback is the original's up to the cut.
    expect(crashed.sections[0].frames.length).toBe(original.sections[0].frames.length);
    const orig = original.sections[1].frames, rec = crashed.sections[1].frames;
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.length).toBeLessThanOrEqual(orig.length);
    expect(rec.every((f, i) => f.type === orig[i].type && f.time === orig[i].time)).toBe(true);
    const repaired = readDemo(writeDemo(crashed, { rebuildDirectory: true }));
    expect(repaired.recovered).toBe(false);
    expect(repaired.problems).toEqual([]);
    const pb = repaired.sections[1];
    expect(pb.frames[pb.frames.length - 1].type).toBe(FrameType.SectionEnd);
    // Every frame before the cut survives, and the playback length matches the last frame kept.
    const kept = crashed.sections[1].frames;
    expect(pb.frames.length).toBe(kept.length + (kept[kept.length - 1].type === FrameType.SectionEnd ? 0 : 1));
    expect(pb.entry!.trackTime).toBeCloseTo(kept[kept.length - 1].time, 3);
    expect(pb.entry!.trackTime).toBeLessThan(original.sections[1].entry!.trackTime);
    // The repaired demo can still be converted for today's game.
    if (repaired.header.networkProtocol === 46) expect(() => upgradeTo48(repaired)).not.toThrow();
  });
});
