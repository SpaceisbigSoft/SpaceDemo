import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { fixDemo, gameResourceCheck, MISSING_IN_BUILD_10210, voiceCodecOf } from '../src/fix/fix.js';
import { voiceCleanup } from '../src/voice/cleanup.js';
import { batchRequest, emulatorDecoder, parseBatchResponse } from '../src/voice/decoders.js';
import { decodeOpus, encodeOpus, oldVoicePackets } from '../src/voice/restore.js';
import { parseSteamVoice } from '../src/voice/steam-voice.js';
import { fixtureDemos } from './fixtures.js';

const tone = (hz: number, seconds: number, amp = 8000, rate = 8000) => Int16Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate)));
const rms = (x: Int16Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('voice pieces', () => {
  it('Opus (built in, WebAssembly) keeps a voice-band tone: 20 ms frames, same length', () => {
    const src = tone(440, 1);
    const frames = encodeOpus(src);
    expect(frames.length).toBe(50);
    const back = decodeOpus(frames, 8000);
    expect(back.length).toBe(src.length);
    expect(rms(back.subarray(800))).toBeGreaterThan(rms(src) * 0.7);
    expect(decodeOpus(frames).length).toBe(src.length * 3); // the game decodes at 24 kHz
  });
  it('decoder batch protocol round-trips', () => {
    const req = batchRequest([{ index: 0, slot: 3, time: 1, data: new Uint8Array([1, 2]) }, { index: 1, slot: 4, time: 2, data: new Uint8Array() }]);
    expect(req.readUInt32LE(0)).toBe(2);
    expect(req.readUInt32LE(4)).toBe(3);
    const resp = Buffer.concat([Buffer.from([4, 0, 0, 0, 1, 0, 2, 0]), Buffer.from([0, 0, 0, 0])]);
    const out = parseBatchResponse(resp, 2);
    expect([...out[0]]).toEqual([1, 2]);
    expect(out[1].length).toBe(0);
    expect(() => parseBatchResponse(resp, 3)).toThrow(/stopped after 2/);
  });
  it('voice cleanup cuts rumble, keeps speech band, evens a quiet burst', () => {
    // Strength of one frequency in a signal (correlation with sine and cosine).
    const at = (x: Int16Array, hz: number) => { let s = 0, c = 0; for (let i = 800; i < x.length; i++) { s += x[i] * Math.sin((2 * Math.PI * hz * i) / 8000); c += x[i] * Math.cos((2 * Math.PI * hz * i) / 8000); } return Math.hypot(s, c); };
    const r = tone(50, 1, 3000), v = tone(1000, 1, 3000);
    const mixed = Int16Array.from(r, (x, i) => x + v[i]);
    const out = voiceCleanup(mixed, 8000);
    expect(at(out, 50) / at(out, 1000)).toBeLessThan((at(mixed, 50) / at(mixed, 1000)) * 0.3); // rumble down ≥ 10 dB vs speech
    const quiet = voiceCleanup(tone(1000, 1, 1000), 8000);
    expect(rms(quiet.subarray(800))).toBeGreaterThan(rms(tone(1000, 1, 1000)) * 2); // quiet burst lifted
  });
  it('knows which old sprites today\'s game lacks', () => {
    const missing = gameResourceCheck();
    expect(MISSING_IN_BUILD_10210.length).toBe(24);
    expect(missing('sprites/top_left2.spr')).toBe(true);
    expect(missing('models/player.mdl')).toBe(false);
  });
});

// Real demos + the owner's own mssvoice.asi (CDF_MSSVOICE) + python3 with unicorn: fix a whole demo.
const asi = process.env.CDF_MSSVOICE;
const demo = fixtureDemos().find((d) => /modCTside\.dem$/i.test(d));
describe.skipIf(!asi || !existsSync(asi) || !demo)('fix: old demo → protocol 48 with its original voice as Steam voice', () => {
  it(`${demo ? basename(demo) : ''}`, () => {
    const input = new Uint8Array(readFileSync(demo!));
    const { bytes, report } = fixDemo(input, { voiceDecoder: emulatorDecoder(asi!) });
    expect(report.sourceProtocol).toBe(46);
    expect(report.converted).toBe(true);
    expect(report.voiceCodec).toBe('voice_miles');
    expect(report.voice!.bursts).toBe(314);
    expect(report.voice!.seconds).toBeGreaterThan(400);
    const out = readDemo(bytes);
    expect(out.problems).toEqual([]);
    expect(out.header.networkProtocol).toBe(48);
    expect(voiceCodecOf(out)).toBe('');
    const packets = oldVoicePackets(out);
    expect(packets.length).toBe(report.voice!.replaced);
    for (const p of packets) expect(() => parseSteamVoice(p.data)).not.toThrow();
  }, 300_000);
});
