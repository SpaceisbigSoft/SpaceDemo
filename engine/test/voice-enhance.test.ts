// 5.g4 AI voice enhancement: resampler, smooth endings, burst handling (with a stand-in model), cache, and — with
// CDF_AI_MODEL (the compact VoiceFixer .onnx) — the real model; with CDF_MSSVOICE + Set 1 demos a whole fix.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { fixDemo, fixDemoAsync } from '../src/fix/fix.js';
import { emulatorDecoder } from '../src/voice/decoders.js';
import { enhanceBursts, onnxEnhancer, restoreInMemory, smoothEndings, type VoiceEnhancer } from '../src/voice/enhance.js';
import { resample } from '../src/voice/resample.js';
import { decodeOpus, encodeOpus, oldVoicePackets } from '../src/voice/restore.js';
import { parseSteamVoice } from '../src/voice/steam-voice.js';
import { fixtureDemos } from './fixtures.js';

const sine = (hz: number, seconds: number, rate: number, amp = 0.3) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rmsF = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const tone16 = (hz: number, seconds: number, amp = 8000) => Int16Array.from({ length: Math.round(seconds * 8000) }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * hz * i) / 8000)));

/** Stand-in model: returns its input (optionally a bit longer, like the real one), counts calls. */
const fake = (extra = 0): VoiceEnhancer & { calls: number[] } => {
  const calls: number[] = [];
  return {
    id: `fake${extra}`, calls,
    async run(seg) { calls.push(seg.length); const y = new Float32Array(seg.length + extra); y.set(seg, Math.floor(extra / 2)); return y; },
  };
};

describe('resampler', () => {
  it('8 → 44.1 → 8 kHz keeps a voice-band tone and the length (librosa rounding)', () => {
    const x = sine(440, 1, 8000);
    const up = resample(x, 8000, 44100);
    expect(up.length).toBe(44100);
    expect(rmsF(up.subarray(2000, 40000))).toBeCloseTo(rmsF(x), 2);
    const back = resample(up, 44100, 8000);
    expect(back.length).toBe(8000);
    let e = 0; for (let i = 500; i < 7500; i++) e += (back[i] - x[i]) ** 2;
    expect(10 * Math.log10((rmsF(x) ** 2 * 7000) / e)).toBeGreaterThan(60);
    expect(resample(new Float32Array(123), 8000, 44100).length).toBe(Math.ceil((123 * 44100) / 8000));
  });
  it('removes what doesn\'t fit the lower rate (a 6 kHz tone going to 8 kHz)', () => {
    const y = resample(sine(6000, 0.5, 44100), 44100, 8000);
    expect(rmsF(y.subarray(200, 3800))).toBeLessThan(0.3 * 0.001);
  });
});

describe('AI voice pieces', () => {
  it('smooth endings: loud parts kept, quiet tail removed, last 20 ms faded', () => {
    const r = 44100, loud = sine(300, 0.3, r, 0.5), quiet = sine(300, 0.6, r, 0.5 * 10 ** (-50 / 20));
    const orig = new Float32Array(loud.length + quiet.length); orig.set(loud); orig.set(quiet, loud.length);
    const out = smoothEndings(orig.slice(), orig, r);
    expect(rmsF(out.subarray(2000, 12000))).toBeCloseTo(rmsF(loud.subarray(2000, 12000)), 3);
    expect(rmsF(out.subarray(loud.length + 14000, out.length - 1000))).toBe(0); // after the 40 ms release has fallen
    expect(Math.abs(out[out.length - 1])).toBe(0);
  });
  it('restore_inmem: 30 s segments, centre trimmed, peak above 1 scaled down', async () => {
    const f = fake(1000);
    const x = sine(200, 40, 44100, 0.2);
    x[100] = 3;
    const y = await restoreInMemory(f, x);
    expect(f.calls).toEqual([44100 * 30, 44100 * 10]);
    expect(y.length).toBe(x.length);
    expect(Math.abs(y[100])).toBeCloseTo(1, 5);
    expect(y[44100 * 35]).toBeCloseTo(x[44100 * 35], 5);
  });
  it('bursts: one model run per player, results at the encode rate, same length, loudness of the original; cached', async () => {
    const audio = [tone16(300, 1), tone16(500, 0.5, 4000), tone16(700, 2)];
    const slots = [3, 5, 3];
    const f = fake();
    const cacheDir = mkdtempSync(join(tmpdir(), 'sd-ai-'));
    for (const rate of [8000, 24000] as const) {
      const out = await enhanceBursts(audio, slots, f, { rate, cacheDir });
      expect(out.map((o) => o.length)).toEqual(audio.map((a) => (a.length * rate) / 8000));
      const rms16 = (x: Int16Array, a: number, b: number) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
      expect(rms16(out[1], rate / 10, rate / 4) / rms16(audio[1], 800, 2000)).toBeCloseTo(1, 1);
    }
    expect(f.calls.length).toBe(4); // 2 players × 2 rates; player 3's bursts joined: 1 s + 0.2 s + 2 s
    expect(f.calls[0]).toBe(Math.ceil((3.2 * 8000 * 44100) / 8000));
    await enhanceBursts(audio, slots, f, { rate: 8000, cacheDir });
    expect(f.calls.length).toBe(4); // from the cache
    expect(readdirSync(cacheDir).filter((n) => n.endsWith('.aivoice')).length).toBe(2);
  });
  it('Opus at 24 kHz: 20 ms frames', () => {
    const x = Int16Array.from({ length: 24000 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));
    const frames = encodeOpus(x, 24000);
    expect(frames.length).toBe(50);
    expect(decodeOpus(frames, 24000).length).toBe(24000);
  });
});

const model = process.env.CDF_AI_MODEL;
describe.skipIf(!model || !existsSync(model))('the compact VoiceFixer model (CDF_AI_MODEL)', () => {
  it('turns a 2 s 8 kHz burst into 44.1 kHz voice with content above 4 kHz', async () => {
    const enh = await onnxEnhancer(model!);
    const burst = Int16Array.from({ length: 16000 }, (_, i) => Math.round(6000 * Math.sin((2 * Math.PI * 200 * i) / 8000) * (1 + Math.sin(i / 300)) + 2000 * Math.sin((2 * Math.PI * 1300 * i) / 8000)));
    const [out] = await enhanceBursts([burst], [1], enh, { rate: 24000 });
    expect(out.length).toBe(48000);
    expect(out.some((v) => v !== 0)).toBe(true);
    await enh.close?.();
  }, 300_000);
});

// Whole demo with a stand-in model (fast): same packets as the plain fix, all valid Steam voice, at both rates.
const asi = process.env.CDF_MSSVOICE;
const demo = fixtureDemos().find((d) => /modCTside\.dem$/i.test(d));
describe.skipIf(!asi || !existsSync(asi) || !demo)('fix with AI voice (stand-in model): bursts stay in place', () => {
  it(`${demo ? basename(demo) : ''}`, async () => {
    const input = new Uint8Array(readFileSync(demo!));
    const plain = fixDemo(input, { voiceDecoder: emulatorDecoder(asi!) });
    for (const rate of [8000, 24000] as const) {
      const { bytes, report } = await fixDemoAsync(input, { voiceDecoder: emulatorDecoder(asi!), ai: { enhancer: fake(700), rate } });
      expect(report.ai!.rate).toBe(rate);
      expect(report.voice!.bursts).toBe(plain.report.voice!.bursts);
      expect(report.voice!.replaced).toBe(plain.report.voice!.replaced);
      const out = oldVoicePackets(readDemo(bytes));
      const ref = oldVoicePackets(readDemo(plain.bytes));
      expect(out.map((p) => [p.slot, p.time])).toEqual(ref.map((p) => [p.slot, p.time]));
      for (const p of out) expect(parseSteamVoice(p.data).chunks.some((c) => c.kind === 'sampleRate')).toBe(true);
    }
    expect(input).toEqual(new Uint8Array(readFileSync(demo!))); // the original is untouched
  }, 600_000);
});
