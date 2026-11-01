// 5.g1 reference: decode a demo's original voice into one 8 kHz track per player on the demo's timeline, plus the
// talk bursts (packets less than 0.3 s apart) of each track. Input for enhance_reference.py.
//   tsx tools/dev/ai-enhance/voice-tracks.ts <demo.dem> <out folder> [--asi <mssvoice.asi>] [--from <s>] [--to <s>]
// Writes mix.wav (all players), track_<slot>.wav and tracks.json. --from/--to are seconds after the first voice packet;
// burst positions in tracks.json are samples (8 kHz) from --from.
// Miles voice needs the user's mssvoice.asi (development emulator, python3 + unicorn); Speex is built in.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDemo } from '../../../engine/src/container/read.js';
import { upgradeTo48 } from '../../../engine/src/transforms/upgrade-to-48.js';
import { oldVoicePackets } from '../../../engine/src/voice/restore.js';
import { emulatorDecoder } from '../../../engine/src/voice/decoders.js';
import { speexDecoder } from '../../../engine/src/voice/speex.js';
import { voiceCodecOf, voiceQualityOf } from '../../../engine/src/fix/fix.js';

const RATE = 8000;
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const asi = opt('--asi'), from = Number(opt('--from') ?? 0), to = Number(opt('--to') ?? Infinity);
const [input, out] = args;
if (!input || !out) throw new Error('usage: voice-tracks.ts <demo.dem> <out> [--asi f] [--from s] [--to s]');
const demo = readDemo(new Uint8Array(readFileSync(input)));
const codec = voiceCodecOf(demo);
const cur = demo.header.networkProtocol === 48 ? demo : upgradeTo48(demo, { isResourceMissing: () => false }).demo;
// Decode every packet (decoders keep state per player, so all packets go in, in order); keep the window afterwards.
const all = oldVoicePackets(cur).filter((p) => p.data.length > 0);
const decoder = codec === 'voice_speex' ? speexDecoder(voiceQualityOf(demo) ?? 5) : asi ? emulatorDecoder(asi) : undefined;
if (!decoder) throw new Error(`No decoder for ${codec} (Miles needs --asi)`);
const pcm = decoder.decodeAll(all);

// Layout (as the 1.6 WAVs and the 1.6d trial): time zero = the first voice packet; per player, each packet's audio
// starts at floor((time - zero) * 8000) or right after that player's previous packet, whichever is later.
// Bursts = a player's packets less than 0.3 s apart. Checked against MoD_CTside_voice_sample_3min_2002_decoder.wav:
// identical for the first 182 s.
const zero = all[0]?.time ?? 0;
type Burst = { slot: number; start: number; end: number; last: number };
const bursts: Burst[] = [];
const open = new Map<number, Burst>();
const cursor = new Map<number, number>();
const at: number[] = [];
all.forEach((p, i) => {
  const a = Math.max(Math.floor((p.time - zero) * RATE), cursor.get(p.slot) ?? -Infinity);
  at.push(a); cursor.set(p.slot, a + pcm[i].length);
  const b = open.get(p.slot);
  if (b && p.time - b.last <= 0.3) { b.last = p.time; b.end = a + pcm[i].length; }
  else { const nb = { slot: p.slot, start: a, end: a + pcm[i].length, last: p.time }; bursts.push(nb); open.set(p.slot, nb); }
});
const w0 = Math.floor(from * RATE), w1 = Number.isFinite(to) ? Math.floor(to * RATE) : Math.max(...bursts.map((b) => b.end));
const len = w1 - w0;
const tracks = new Map<number, Float64Array>();
all.forEach((p, i) => {
  const t = tracks.get(p.slot) ?? new Float64Array(len);
  tracks.set(p.slot, t);
  for (let k = 0, o = at[i] - w0; k < pcm[i].length; k++, o++) if (o >= 0 && o < len) t[o] += pcm[i][k];
});
for (const [slot, t] of tracks) if (!t.some((v) => v !== 0)) tracks.delete(slot);
const list = bursts.filter((b) => b.end > w0 && b.start < w1)
  .map((b) => ({ slot: b.slot, start: Math.max(0, b.start - w0), samples: Math.min(b.end, w1) - Math.max(b.start, w0) }));

const wav = (s: Float64Array) => {
  const b = Buffer.alloc(44 + s.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i]))), 44 + i * 2);
  return b;
};
mkdirSync(out, { recursive: true });
const mix = new Float64Array(len);
for (const [slot, t] of tracks) { writeFileSync(join(out, `track_${slot}.wav`), wav(t)); t.forEach((v, i) => (mix[i] += v)); }
writeFileSync(join(out, 'mix.wav'), wav(mix));
// Every decoded packet (for trying other layouts): packets.json (slot, time, samples) + packets.pcm (16-bit).
writeFileSync(join(out, 'packets.json'), JSON.stringify(all.map((p, i) => [p.slot, p.time, pcm[i].length])));
writeFileSync(join(out, 'packets.pcm'), Buffer.concat(pcm.map((x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength))));
writeFileSync(join(out, 'tracks.json'), JSON.stringify({ demo: input, codec, rate: RATE, zero, from, samples: len, slots: [...tracks.keys()], bursts: list }, null, 1));
console.log(`${codec}: ${list.length} bursts from ${tracks.size} players, ${(len / RATE).toFixed(1)} s → ${out}`);
