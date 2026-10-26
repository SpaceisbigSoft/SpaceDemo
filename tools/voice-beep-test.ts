// Experiment (plan 1.6, route A plumbing): replace each old voice packet with Steam-voice Opus beeps,
// one pitch per player, to check that today's game plays injected voice.
//   npx tsx tools/voice-beep-test.ts <converted-48.dem> <output.dem>
// Needs ffmpeg with libopus (development machine only).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { writeDemo } from '../engine/src/container/write.js';
import { replaceVoice } from '../engine/src/transforms/replace-voice.js';
import { opusVoicePacket } from '../engine/src/voice/steam-voice.js';

/** Encodes `seconds` of a sine tone to 20 ms Opus packets (24 kHz mono, voice mode) and returns the packets. */
function opusTone(freq: number, seconds: number): Uint8Array[] {
  const ogg = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=24000`,
    '-af', 'volume=0.3', '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-application', 'voip', '-b:a', '24k', '-frame_duration', '20', '-f', 'ogg', 'pipe:1'], { maxBuffer: 1 << 26 });
  return oggPackets(new Uint8Array(ogg)).slice(2); // skip OpusHead and OpusTags
}

/** Minimal Ogg page reader returning the packets of a single logical stream. */
function oggPackets(b: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let pending: number[] = [];
  let p = 0;
  while (p + 27 <= b.length) {
    if (b[p] !== 0x4f || b[p + 1] !== 0x67 || b[p + 2] !== 0x67 || b[p + 3] !== 0x53) throw new Error('Bad Ogg page');
    const segments = b[p + 26];
    const table = b.subarray(p + 27, p + 27 + segments);
    let q = p + 27 + segments;
    for (const len of table) {
      for (let i = 0; i < len; i++) pending.push(b[q + i]);
      q += len;
      if (len < 255) {
        packets.push(Uint8Array.from(pending));
        pending = [];
      }
    }
    p = q;
  }
  return packets;
}

const [input, output] = process.argv.slice(2);
const pitches = [330, 392, 440, 523, 587, 659, 784, 880];
const tones = new Map<number, Uint8Array[]>();
const position = new Map<number, number>();
const sequence = new Map<number, number>();
const demo = readDemo(new Uint8Array(readFileSync(input)));
const { demo: out, report } = replaceVoice(demo, ({ slot, data }) => {
  if (data.length === 0) return null; // the recorder's own (empty) packets
  if (!tones.has(slot)) tones.set(slot, opusTone(pitches[slot % pitches.length], 30));
  const tone = tones.get(slot)!;
  // Miles/Voxware packets carry 40 ms per 12 bytes; Opus frames are 20 ms.
  const frameCount = Math.max(1, Math.round((data.length / 12) * 2));
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const pos = (position.get(slot) ?? 0) % tone.length;
    position.set(slot, pos + 1);
    const seq = sequence.get(slot) ?? 0;
    sequence.set(slot, seq + 1);
    frames.push({ sequence: seq, data: tone[pos] });
  }
  return opusVoicePacket(76561197960265728n + BigInt(slot + 1), 24000, frames);
});
writeFileSync(output, writeDemo(out, { rebuildDirectory: true }));
console.log(`Wrote ${output}: ${report.replaced} voice packets replaced with beeps, ${report.dropped} empty ones dropped.`);
