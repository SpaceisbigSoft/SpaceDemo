import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSteamVoice, opusVoicePacket, parseSteamVoice } from '../src/voice/steam-voice.js';
import { readDemo } from '../src/container/read.js';
import { FrameType } from '../src/container/types.js';
import { createState, decodeMessages } from '../src/protocol/messages.js';
import { fixtureDemos } from './fixtures.js';

describe('Steam voice packets', () => {
  it('builds and parses packets with mixed chunks', () => {
    const packet = {
      steamId: 76561197960265729n,
      chunks: [
        { kind: 'sampleRate' as const, rate: 24000 },
        { kind: 'opus' as const, frames: [{ sequence: 0, data: Uint8Array.of(0x68, 1, 2, 3) }, { sequence: 1, data: Uint8Array.of(0x68, 9) }], endOfBurst: true },
        { kind: 'silence' as const, samples: 1500 },
      ],
    };
    expect(parseSteamVoice(buildSteamVoice(packet))).toEqual(packet);
  });

  it('rejects a damaged packet', () => {
    const bytes = opusVoicePacket(1n, 24000, [{ sequence: 0, data: Uint8Array.of(0x68) }]);
    bytes[10] ^= 1;
    expect(() => parseSteamVoice(bytes)).toThrow(/checksum/);
  });
});

// A protocol-48 demo recorded on build 10210 with voice (e.g. voicetest.dem) in CDF_DEMOS makes this run.
const modern = fixtureDemos().filter((p) => readDemo(new Uint8Array(readFileSync(p))).header.networkProtocol === 48);

describe.skipIf(modern.length === 0)('Steam voice in real protocol-48 demos', () => {
  it.each(modern)('%s: every voice packet parses and rebuilds byte-identically', (path) => {
    const demo = readDemo(new Uint8Array(readFileSync(path)));
    const state = createState(48, demo.header.gameDir);
    let count = 0;
    for (const s of demo.sections)
      for (const f of s.frames) {
        if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
        for (const m of decodeMessages(f.messages, state)) {
          if (m.body?.kind !== 'voiceData' || m.body.data.length === 0) continue;
          const parsed = parseSteamVoice(m.body.data);
          expect(Buffer.from(buildSteamVoice(parsed)).equals(Buffer.from(m.body.data))).toBe(true);
          count++;
        }
      }
    expect(count).toBeGreaterThan(0);
  });
});
