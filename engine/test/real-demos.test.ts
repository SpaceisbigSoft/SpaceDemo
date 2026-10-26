import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { writeDemo } from '../src/container/write.js';
import { fixtureDemos } from './fixtures.js';

const demos = fixtureDemos();

describe.skipIf(demos.length === 0)('real demos (CDF_DEMOS)', () => {
  it.each(demos.map((d) => [basename(d), d]))('%s: container round-trips byte-for-byte', (_name, path) => {
    const bytes = new Uint8Array(readFileSync(path));
    const demo = readDemo(bytes);
    expect(demo.problems).toEqual([]);
    const again = writeDemo(demo);
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
});
