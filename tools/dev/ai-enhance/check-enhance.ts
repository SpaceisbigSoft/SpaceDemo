// 5.g4 check: the engine's AI enhancement (engine/src/voice/enhance.ts) against the Python reference (5.g1).
//   tsx tools/dev/ai-enhance/check-enhance.ts <tracks dir from voice-tracks.ts> <model.onnx> <reference.wav> [out.wav]
// Runs enhanceBursts() on the same bursts at 44.1 kHz, mixes them on the same timeline and prints the SNR against the
// reference (enhance_reference.py --size mixed --smooth on the same tracks), plus the time per minute of voice.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enhanceBursts, onnxEnhancer } from '../../../engine/src/voice/enhance.js';

const [dir, model, refPath, outPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(dir, 'tracks.json'), 'utf8')) as { samples: number; slots: number[]; bursts: { slot: number; start: number; samples: number }[] };
const wav = (p: string) => { const b = readFileSync(p); const d = b.indexOf('data') + 8; return new Int16Array(b.buffer.slice(b.byteOffset + d, b.byteOffset + b.length)); };
const tracks = new Map(meta.slots.map((s) => [s, wav(join(dir, `track_${s}.wav`))]));
const audio = meta.bursts.map((b) => tracks.get(b.slot)!.slice(b.start, b.start + b.samples));
const slots = meta.bursts.map((b) => b.slot);
const enh = await onnxEnhancer(model);
const t0 = Date.now();
const out = await enhanceBursts(audio, slots, enh, { rate: 44100 });
const secs = (Date.now() - t0) / 1000, voice = audio.reduce((n, a) => n + a.length, 0) / 8000;
const total = Math.ceil((meta.samples * 44100) / 8000);
const mix = new Float64Array(total);
meta.bursts.forEach((b, i) => { const t = Math.round((b.start * 44100) / 8000); out[i].forEach((v, k) => { if (t + k < total) mix[t + k] += v; }); });
const ref = wav(refPath);
let e = 0, s = 0;
for (let i = 0; i < Math.min(ref.length, mix.length); i++) { s += ref[i] ** 2; e += (ref[i] - mix[i]) ** 2; }
console.log(`${meta.bursts.length} bursts, ${voice.toFixed(1)} s of voice in ${secs.toFixed(1)} s (${((secs / voice) * 60).toFixed(0)} s per minute); SNR vs reference ${(10 * Math.log10(s / e)).toFixed(1)} dB`);
if (outPath) {
  const b = Buffer.alloc(44 + total * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + total * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(total * 2, 40);
  mix.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), 44 + i * 2));
  writeFileSync(outPath, b);
}
await enh.close?.();
