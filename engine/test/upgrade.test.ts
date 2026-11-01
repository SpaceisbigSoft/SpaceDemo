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

const demos = fixtureDemos().filter((p) => readDemo(new Uint8Array(readFileSync(p))).header.networkProtocol !== 48);

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

// 0.8 old maps: the map is renamed everywhere the game reads it (header, server info, resource list), nothing else.
describe.skipIf(!demos.length)('rename the map (0.8)', () => {
  it(`${demos[0] ? basename(demos[0]) : ''}`, () => {
    const demo = readDemo(new Uint8Array(readFileSync(demos[0])));
    const { demo: up, report } = upgradeTo48(demo, { mapName: 'de_test_0123abcd' });
    expect(report.applied['map renamed']).toBe(1);
    const back = readDemo(writeDemo(up));
    expect(back.header.mapName).toBe('de_test_0123abcd');
    expect(back.header.mapChecksum).toBe(demo.header.mapChecksum);
    const state = createState(48, 'cstrike');
    const names: string[] = [], res: string[] = [];
    for (const f of back.sections[0].frames) {
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      for (const m of decodeMessages(f.messages, state)) {
        if (m.body?.kind === 'serverInfo') names.push(m.body.mapName);
        if (m.body?.kind === 'resourceList') res.push(...m.body.resources.map((r) => r.name.toLowerCase()));
      }
    }
    expect(names).toEqual(['maps/de_test_0123abcd.bsp']);
    const old = `maps/${demo.header.mapName.toLowerCase()}.bsp`;
    expect(res).not.toContain(old);
    // Without the option nothing changes.
    expect(readDemo(writeDemo(upgradeTo48(demo).demo)).header.mapName).toBe(demo.header.mapName);
  });
});
