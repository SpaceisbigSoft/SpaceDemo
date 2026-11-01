// AI voice enhancement (plan 5.g4; decided in 1.6d, reference rebuilt in 5.g1, compact model in 5.g3).
// Per player: that player's talk bursts joined with 0.2 s silences → 44.1 kHz → VoiceFixer (ONNX, 30 s segments, as
// restore_inmem) → cut back into bursts → loudness matched to the original burst → smooth word endings → resampled to
// the Steam voice encode rate. The result replaces each burst's audio in restoreVoice(); the original demo is untouched
// and the plain fix stays available. Same steps and numbers as tools/dev/ai-enhance/enhance_reference.py.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resample, toFloat, toInt16 } from './resample.js';
import { OLD_VOICE_RATE } from './restore.js';

export const MODEL_RATE = 44100;

/** The compact VoiceFixer model (5.g3), hosted as a release file on the SpaceDemo GitHub repo (owner, Q13). Licence:
 * CC BY 4.0 (Haohe Liu, VoiceFixer); our copy is compressed (mixed sizing) — credit + "changed" note in the app. */
export const AI_MODEL = {
  file: 'spacedemo-voicefixer-mixed.onnx',
  url: 'https://github.com/SpaceisbigSoft/SpaceDemo/releases/download/ai-model-v1/spacedemo-voicefixer-mixed.onnx',
  bytes: 142_164_205,
  sha256: 'a9e8c9a5e229b8f41c24e09dfadf2e55e64587d03af2bfe8727a55f21e25025e',
} as const;
const SEGMENT = MODEL_RATE * 30;
const GAP_SECONDS = 0.2;

/** Runs the model on one segment (≤ 30 s at 44.1 kHz) and returns its raw output (about as long as the input). */
export interface VoiceEnhancer {
  /** Identifies the model (for the cache). */
  id: string;
  run(segment: Float32Array): Promise<Float32Array>;
  close?(): Promise<void>;
}

/** The compact VoiceFixer model (5.g3) with ONNX Runtime. `onnxruntime-node` is loaded only when this is used. */
export async function onnxEnhancer(modelPath: string, options: { threads?: number } = {}): Promise<VoiceEnhancer> {
  const ort = await import('onnxruntime-node');
  const bytes = readFileSync(modelPath);
  const id = 'onnx:' + createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const session = await ort.InferenceSession.create(bytes, {
    graphOptimizationLevel: 'all',
    ...(options.threads ? { intraOpNumThreads: options.threads } : {}),
  });
  return {
    id,
    async run(segment) {
      const r = await session.run({ wav: new ort.Tensor('float32', segment, [1, 1, segment.length]) });
      return r.out.data as Float32Array;
    },
    async close() { await session.release(); },
  };
}

/** VoiceFixer.restore_inmem (mode 0): 30 s segments, peak above 1 scaled down, centre trimmed to the input length. */
export async function restoreInMemory(enhancer: VoiceEnhancer, wav: Float32Array): Promise<Float32Array> {
  const out = new Float32Array(wav.length);
  for (let start = 0; start < wav.length; start += SEGMENT) {
    const seg = wav.slice(start, Math.min(wav.length, start + SEGMENT));
    let y = await enhancer.run(seg);
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    if (peak > 1) y = y.map((v) => v / peak);
    const d = y.length - seg.length;
    const from = d > 0 ? Math.floor(d / 2) : 0;
    out.set(y.subarray(from, from + Math.min(seg.length, y.length - from)), start);
  }
  return out;
}

/** Peak follower: fast rise (attack), slow fall (release). */
export function envelope(x: Float32Array, rate: number, attack = 0.005, release = 0.04): Float32Array {
  const a = Math.exp(-1 / (attack * rate)), r = Math.exp(-1 / (release * rate));
  const out = new Float32Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    e = v > e ? a * e + (1 - a) * v : r * e + (1 - r) * v;
    out[i] = e;
  }
  return out;
}

/** Smooth word endings (5.g1): gain 1 above the burst's peak −24 dB, (envelope ÷ knee)^1.5 below, 0 under −45 dB,
 * then a 20 ms fade-out. `original` = the original burst at the same rate. Changes `x` in place. */
export function smoothEndings(x: Float32Array, original: Float32Array, rate: number): Float32Array {
  const env = envelope(original, rate);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak <= 0) return x;
  const knee = peak * 10 ** (-24 / 20), floor = peak * 10 ** (-45 / 20);
  for (let i = 0; i < x.length; i++) x[i] *= env[i] < floor ? 0 : Math.min(1, (env[i] / knee) ** 1.5);
  const n = Math.min(x.length, Math.round(0.02 * rate));
  for (let i = 0; i < n; i++) x[x.length - n + i] *= 1 - i / Math.max(1, n - 1);
  return x;
}

const rms = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return x.length ? Math.sqrt(s / x.length) : 0; };

export interface EnhanceOptions {
  /** Rate of the returned audio (the Steam voice encode rate, 8000 or 24000; default 8000; 44100 for checks). */
  rate?: number;
  /** Folder for finished results (same demo + model + rate = no second run). */
  cacheDir?: string;
  /** Seconds of voice done / total, after each player. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * AI-enhanced audio for every talk burst. `bursts` = talkBursts() (lists of packet indexes), `slots[i]` = player slot
 * of burst i, `audio[i]` = its decoded 8 kHz audio (burstAudio()). Returns one Int16Array per burst at `rate`, exactly
 * as long as the burst (samples × rate / 8000, rounded).
 */
export async function enhanceBursts(audio: Int16Array[], slots: number[], enhancer: VoiceEnhancer, options: EnhanceOptions = {}): Promise<Int16Array[]> {
  const rate = options.rate ?? OLD_VOICE_RATE;
  const key = createHash('sha256').update(`${enhancer.id}|${rate}|${slots.join(',')}|`);
  for (const a of audio) key.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const cacheFile = options.cacheDir ? join(options.cacheDir, `${key.digest('hex').slice(0, 32)}.aivoice`) : undefined;
  if (cacheFile && existsSync(cacheFile)) {
    const cached = readCache(readFileSync(cacheFile));
    if (cached.length === audio.length && cached.every((c, i) => c.length === outLength(audio[i].length, rate))) return cached;
  }

  const result: Int16Array[] = new Array(audio.length);
  const total = audio.reduce((n, a) => n + a.length, 0) / OLD_VOICE_RATE;
  let done = 0;
  const gap = Math.round(GAP_SECONDS * OLD_VOICE_RATE);
  for (const slot of [...new Set(slots)]) {
    const mine = slots.flatMap((s, i) => (s === slot ? [i] : []));
    // Join this player's bursts with 0.2 s silences.
    const spots: { burst: number; at: number; n: number }[] = [];
    let len = 0;
    for (const i of mine) { if (spots.length) len += gap; spots.push({ burst: i, at: len, n: audio[i].length }); len += audio[i].length; }
    const joined = new Float32Array(len);
    for (const s of spots) joined.set(toFloat(audio[s.burst]), s.at);
    const orig44 = resample(joined, OLD_VOICE_RATE, MODEL_RATE);
    const enh = await restoreInMemory(enhancer, orig44);
    for (const s of spots) {
      const j0 = Math.round((s.at * MODEL_RATE) / OLD_VOICE_RATE), j1 = Math.round(((s.at + s.n) * MODEL_RATE) / OLD_VOICE_RATE);
      const piece = enh.slice(j0, j1), ref = orig44.subarray(j0, j1);
      const a = rms(piece), b = rms(ref);
      if (a > 0) for (let k = 0; k < piece.length; k++) piece[k] *= b / a;
      smoothEndings(piece, ref, MODEL_RATE);
      const out = resample(piece, MODEL_RATE, rate);
      const want = outLength(s.n, rate);
      const fixed = new Float32Array(want);
      fixed.set(out.subarray(0, want));
      result[s.burst] = toInt16(fixed);
      done += s.n / OLD_VOICE_RATE;
    }
    options.onProgress?.(Math.round(done * 10) / 10, Math.round(total * 10) / 10);
  }
  if (cacheFile && options.cacheDir) {
    mkdirSync(options.cacheDir, { recursive: true });
    writeFileSync(cacheFile + '.tmp', writeCache(result));
    renameSync(cacheFile + '.tmp', cacheFile);
  }
  return result;
}

const outLength = (n8: number, rate: number) => Math.round((n8 * rate) / OLD_VOICE_RATE);

// Cache file: "SDAI" u32 version, u32 count, count × u32 length, then the samples (16-bit).
function writeCache(parts: Int16Array[]): Uint8Array {
  const head = Buffer.alloc(12 + parts.length * 4);
  head.write('SDAI', 0); head.writeUInt32LE(1, 4); head.writeUInt32LE(parts.length, 8);
  parts.forEach((p, i) => head.writeUInt32LE(p.length, 12 + i * 4));
  return Buffer.concat([head, ...parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))]);
}
function readCache(b: Buffer): Int16Array[] {
  if (b.toString('latin1', 0, 4) !== 'SDAI' || b.readUInt32LE(4) !== 1) return [];
  const n = b.readUInt32LE(8);
  let at = 12 + n * 4;
  const out: Int16Array[] = [];
  for (let i = 0; i < n; i++) {
    const len = b.readUInt32LE(12 + i * 4);
    const copy = new Int16Array(len);
    copy.set(new Int16Array(b.buffer.slice(b.byteOffset + at, b.byteOffset + at + len * 2)));
    out.push(copy); at += len * 2;
  }
  return out;
}
