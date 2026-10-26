import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { writeDemo } from '../src/container/write.js';
import { FrameType } from '../src/container/types.js';
import { createState, decodeMessages } from '../src/protocol/messages.js';
import { upgradePlayerSequence, upgradeTo48 } from '../src/transforms/upgrade-to-48.js';
import { fixtureDemos } from './fixtures.js';

describe('upgradePlayerSequence', () => {
  it('moves sequences 83 and up by 16, leaves others', () => {
    expect(upgradePlayerSequence(0)).toBe(0);
    expect(upgradePlayerSequence(82)).toBe(82);
    expect(upgradePlayerSequence(83)).toBe(99);
    expect(upgradePlayerSequence(100)).toBe(116);
  });
});

const demos = fixtureDemos();

describe.skipIf(demos.length === 0)('upgrade real demos to protocol 48 (CDF_DEMOS)', () => {
  it.each(demos.map((d) => [basename(d), d]))('%s: converted demo reads cleanly as protocol 48', (_n, path) => {
    const original = readDemo(new Uint8Array(readFileSync(path)));
    const { demo, report } = upgradeTo48(original, { isResourceMissing: (n) => n.startsWith('sprites/top') });
    expect(report.applied['server info: protocol 48']).toBeGreaterThan(0);
    const bytes = writeDemo(demo, { rebuildDirectory: true });
    const again = readDemo(bytes);
    expect(again.problems).toEqual([]);
    expect(again.header.networkProtocol).toBe(48);
    // Every message must decode with protocol-48 rules (6-bit weapon index, voice quality byte, ...).
    const state = createState(48, 'cstrike');
    let voiceInits = 0;
    for (const s of again.sections)
      for (const f of s.frames) {
        if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
        for (const m of decodeMessages(f.messages, state)) {
          if (m.body?.kind === 'voiceInit') {
            voiceInits++;
            expect(m.body.quality).toBe(5);
          }
          if (m.body?.kind === 'serverInfo') expect(m.body.protocol).toBe(48);
        }
      }
    expect(voiceInits).toBeGreaterThan(0);
  });
});
