// 5.v trial helper: decode a demo's original voice and write one WAV per talk burst (8 kHz mono), with a list of who
// talked when (bursts.json). Used to try speech-to-text per player.
//   tsx tools/dev/voice-bursts.ts <demo.dem> <out folder> [--asi <mssvoice.asi>] [--from <s>] [--to <s>]
// Miles voice needs the user's mssvoice.asi (development emulator, python3 + unicorn); Speex is built in.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { upgradeTo48 } from '../../engine/src/transforms/upgrade-to-48.js';
import { oldVoicePackets } from '../../engine/src/voice/restore.js';
import { emulatorDecoder } from '../../engine/src/voice/decoders.js';
import { speexDecoder } from '../../engine/src/voice/speex.js';
import { voiceCodecOf, voiceQualityOf } from '../../engine/src/fix/fix.js';
import { extractMatch } from '../../engine/src/match/extract.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const asi = opt('--asi'), from = Number(opt('--from') ?? 0), to = Number(opt('--to') ?? Infinity);
const [input, out] = args;
const demo = readDemo(new Uint8Array(readFileSync(input)));
const m = extractMatch(demo);
const codec = voiceCodecOf(demo);
const cur = demo.header.networkProtocol === 48 ? demo : upgradeTo48(demo, { isResourceMissing: () => false }).demo;
const packets = oldVoicePackets(cur).filter((p) => p.data.length > 0 && p.time >= from && p.time <= to);
const decoder = codec === 'voice_speex' ? speexDecoder(voiceQualityOf(demo) ?? 5) : asi ? emulatorDecoder(asi) : undefined;
if (!decoder) throw new Error(`No decoder for ${codec} (Miles needs --asi)`);
const pcm = decoder.decodeAll(packets);
mkdirSync(out, { recursive: true });

const wav = (s: Int16Array, rate = 8000) => {
  const b = Buffer.alloc(44 + s.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) b.writeInt16LE(s[i], 44 + i * 2);
  return b;
};
// Bursts: per slot, packets less than 0.3 s apart.
const bursts: { slot: number; start: number; end: number; parts: Int16Array[] }[] = [];
const open = new Map<number, (typeof bursts)[number]>();
packets.forEach((p, i) => {
  const b = open.get(p.slot);
  if (b && p.time - b.end <= 0.3) { b.end = p.time; b.parts.push(pcm[i]); }
  else { const nb = { slot: p.slot, start: p.time, end: p.time, parts: [pcm[i]] }; bursts.push(nb); open.set(p.slot, nb); }
});
const nameAt = (slot: number, t: number) => {
  const vb = m.voice.find((v) => v.slot === slot && v.start <= t + 0.5 && v.end >= t - 0.5);
  return m.players.find((p) => p.id === vb?.player)?.name ?? m.players.filter((p) => p.slot === slot).at(-1)?.name ?? `slot ${slot}`;
};
const list = bursts.filter((b) => b.end - b.start >= 0.4).map((b, i) => {
  const len = b.parts.reduce((a, x) => a + x.length, 0);
  const s = new Int16Array(len);
  let o = 0;
  for (const x of b.parts) { s.set(x, o); o += x.length; }
  const file = `${String(i + 1).padStart(3, '0')}_${b.start.toFixed(1)}s.wav`;
  writeFileSync(join(out, file), wav(s));
  return { file, player: nameAt(b.slot, b.start), start: Math.round(b.start * 10) / 10, seconds: Math.round((len / 8000) * 10) / 10 };
});
writeFileSync(join(out, 'bursts.json'), JSON.stringify({ demo: input, codec, bursts: list }, null, 1));
console.log(`${codec}: ${packets.length} packets → ${list.length} bursts (${list.reduce((a, b) => a + b.seconds, 0).toFixed(0)} s) in ${out}`);
