// 2.17 Speex voice: frame sizes per GoldSrc voice quality, the built-in decoder (Xiph libspeex in WebAssembly), and
// with CDF_SET3 (a folder of Set 3 protocol-47 demos) whole demos fixed with their Speex voice put back as Steam voice.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixDemo } from '../src/fix/fix.js';
import { inspectDemo } from '../src/inspect.js';
import { decodeSpeexPackets, frameBytesFromPackets, speexFrameBytes } from '../src/voice/speex.js';

describe('2.17 Speex voice', () => {
  it('uses Valve\'s frame size per voice quality (5 → 38 bytes, 3 → 20 bytes)', () => {
    expect([1, 2, 3, 4, 5].map((q) => speexFrameBytes(q))).toEqual([15, 15, 20, 28, 38]);
    expect(speexFrameBytes(undefined)).toBe(38);
  });
  it('trusts the packets when they don\'t fit the announced quality', () => {
    const pk = (n: number) => ({ index: 0, slot: 0, time: 0, data: new Uint8Array(n) });
    expect(frameBytesFromPackets([pk(20), pk(60), pk(40)], 38)).toBe(20);
    expect(frameBytesFromPackets([pk(38), pk(114)], 38)).toBe(38);
    expect(frameBytesFromPackets([], 28)).toBe(28);
  });
  it('decodes frames into 160 samples each, one decoder per player, and survives garbage', () => {
    const stats = { frames: 0, corrupt: 0, odd: 0 };
    const junk = new Uint8Array(38 * 2).map((_, i) => (i * 37 + 11) & 255);
    const pcm = decodeSpeexPackets([{ index: 0, slot: 1, time: 0, data: junk }, { index: 1, slot: 2, time: 0, data: new Uint8Array(0) }, { index: 2, slot: 1, time: 0, data: junk.subarray(0, 40) }], 5, stats);
    expect(pcm.map((p) => p.length)).toEqual([320, 0, 160]);
    expect(stats.frames).toBe(3);
    expect(stats.odd).toBe(1);
  });
});

const set3 = process.env.CDF_SET3;
describe.skipIf(!set3)('2.7 + 2.17 on Set 3 protocol-47 demos (CDF_SET3)', () => {
  const files = set3 ? readdirSync(set3).filter((f) => /\.dem$/i.test(f)).map((f) => join(set3, f)) : [];
  for (const f of files) {
    it(`${f.split('/').pop()}: converts to 48 and its voice comes back`, () => {
      const src = new Uint8Array(readFileSync(f));
      const before = inspectDemo(src);
      const { bytes, report } = fixDemo(src);
      const after = inspectDemo(bytes);
      expect(after.networkProtocol).toBe(48);
      expect(after.problems).toEqual([]);
      if (before.voiceCodec === 'voice_speex' && before.players.some((p) => p.voicePackets > p.emptyVoicePackets)) {
        expect(report.voice?.replaced).toBeGreaterThan(0);
        expect(after.voiceCodec ?? '').toBe('');
        expect(report.notes.join(' ')).not.toMatch(/damaged/);
      }
    }, 120_000);
  }
});
