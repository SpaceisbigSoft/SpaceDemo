// Experiment (plan 1.6, route A): put the ORIGINAL old voice back into a converted demo as Steam voice.
//   npx tsx tools/voice-transcode-test.ts <converted-48.dem> <decoded.pcm> <output.dem>
// <decoded.pcm> holds, for every svc_voicedata message in demo order, [u32 byte length][8 kHz 16-bit mono PCM]
// (made by tools/dev/miles-emu/decode_all.py from the owner's own mssvoice.asi). Needs ffmpeg with libopus
// (development machine only).
//
// Each talk burst of a player is re-encoded as one Opus stream (24 kHz, 20 ms frames, as today's game sends) and
// its frames are handed out over the burst's original packets in step with the audio each packet carried, so the
// voice stays where it was in the demo. The last packet of a burst carries the end-of-burst marker.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { writeDemo } from '../engine/src/container/write.js';
import { writeNewFile } from '../engine/src/fix/safe-output.js';
import { replaceVoice } from '../engine/src/transforms/replace-voice.js';
import { opusVoicePacket, type OpusFrame } from '../engine/src/voice/steam-voice.js';
import { oggPackets } from './ogg.js';

const SOURCE_RATE = 8000;
const STEAM_RATE = 24000;
const FRAME_SAMPLES = (STEAM_RATE * 20) / 1000; // 480
const BURST_GAP_SECONDS = 0.3;

function readPcmList(path: string): Buffer[] {
  const b = readFileSync(path);
  const out: Buffer[] = [];
  for (let p = 0; p < b.length; ) {
    const n = b.readUInt32LE(p);
    out.push(b.subarray(p + 4, p + 4 + n));
    p += 4 + n;
  }
  return out;
}

/** 8 kHz PCM -> 24 kHz Opus packets (20 ms, voice mode). */
function encodeOpus(pcm: Buffer): Uint8Array[] {
  const ogg = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(SOURCE_RATE), '-ac', '1', '-i', 'pipe:0',
    '-ar', String(STEAM_RATE), '-c:a', 'libopus', '-application', 'voip', '-b:a', '24k', '-frame_duration', '20', '-f', 'ogg', 'pipe:1'],
  { input: pcm, maxBuffer: 1 << 26 });
  return oggPackets(new Uint8Array(ogg)).slice(2); // skip OpusHead and OpusTags
}

const [demoPath, pcmPath, output] = process.argv.slice(2);
if (!output) {
  console.log('Usage: npx tsx tools/voice-transcode-test.ts <converted-48.dem> <decoded.pcm> <output.dem>');
  process.exit(1);
}
const demo = readDemo(new Uint8Array(readFileSync(demoPath)));
const pcm = readPcmList(pcmPath);

// Pass 1: where is every packet, and which talk burst does it belong to?
const info: { slot: number; time: number }[] = [];
replaceVoice(demo, ({ slot, time, data }) => (info.push({ slot, time }), data));
if (info.length !== pcm.length) throw new Error(`Demo has ${info.length} voice packets but the PCM file has ${pcm.length}`);

interface Burst { packets: number[] }
const bursts: Burst[] = [];
const open = new Map<number, { burst: Burst; lastTime: number }>();
info.forEach(({ slot, time }, i) => {
  if (pcm[i].length === 0) return; // the recorder's own empty packets
  const cur = open.get(slot);
  // A burst ends after a gap, or when the demo clock jumps back (each demo section restarts its clock).
  if (cur && time >= cur.lastTime && time - cur.lastTime <= BURST_GAP_SECONDS) {
    cur.burst.packets.push(i);
    cur.lastTime = time;
  } else {
    const burst = { packets: [i] };
    bursts.push(burst);
    open.set(slot, { burst, lastTime: time });
  }
});

// Pass 2: encode each burst and share its Opus frames out over its packets.
const framesFor = new Map<number, { frames: Uint8Array[]; end: boolean }>();
for (const b of bursts) {
  const frames = encodeOpus(Buffer.concat(b.packets.map((i) => pcm[i])));
  let samples = 0;
  let given = 0;
  b.packets.forEach((i, k) => {
    samples += pcm[i].length / 2;
    const last = k === b.packets.length - 1;
    const upTo = last ? frames.length : Math.min(frames.length, Math.floor((samples * (STEAM_RATE / SOURCE_RATE)) / FRAME_SAMPLES));
    framesFor.set(i, { frames: frames.slice(given, upTo), end: last });
    given = upTo;
  });
}

const sequence = new Map<number, number>();
let index = 0;
let silentPackets = 0;
const { demo: out, report } = replaceVoice(demo, ({ slot }) => {
  const mine = framesFor.get(index++);
  if (!mine) return null; // empty packet: drop
  if (mine.frames.length === 0 && !mine.end) {
    silentPackets++;
    return null; // audio arrives with the next packet of the burst
  }
  const frames: OpusFrame[] = mine.frames.map((data) => {
    const seq = sequence.get(slot) ?? 0;
    sequence.set(slot, seq + 1);
    return { sequence: seq, data };
  });
  return opusVoicePacket(76561197960265728n + BigInt(slot + 1), STEAM_RATE, frames, mine.end);
});
writeNewFile([demoPath, pcmPath], output, writeDemo(out, { rebuildDirectory: true }));
console.log(`Wrote ${output}: ${bursts.length} talk bursts, ${report.replaced} packets with original voice, ` +
  `${report.dropped} dropped (${report.dropped - silentPackets} empty, ${silentPackets} folded into the next packet).`);
