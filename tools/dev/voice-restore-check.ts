// Plan 2.8 check: a fixed demo's voice is valid Steam voice, sounds like the original and stays in sync.
//   npx tsx tools/dev/voice-restore-check.ts <old demo.dem> <fixed demo.dem> <mssvoice.asi>
import { readFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { upgradeTo48 } from '../../engine/src/transforms/upgrade-to-48.js';
import { oldVoicePackets, decodeOpus, BURST_GAP_SECONDS } from '../../engine/src/voice/restore.js';
import { emulatorDecoder } from '../../engine/src/voice/decoders.js';
import { parseSteamVoice } from '../../engine/src/voice/steam-voice.js';

const [oldPath, fixedPath, asi] = process.argv.slice(2);
const fixed = readDemo(new Uint8Array(readFileSync(fixedPath)));
console.log(`fixed demo reads ${fixed.problems.length ? 'with problems: ' + fixed.problems.join('; ') : 'cleanly'}; protocol ${fixed.header.networkProtocol}`);
// 1. every voice message parses as Steam voice (checksum included)
const newPackets = oldVoicePackets(fixed);
let bad = 0;
const parsed = newPackets.map((p) => { try { return parseSteamVoice(p.data); } catch { bad++; return undefined; } });
console.log(`${newPackets.length} voice messages; not valid Steam voice: ${bad}`);
// 2. per slot: rebuild bursts from the new demo, decode Opus at 8 kHz, compare with the original decoded audio
const old = upgradeTo48(readDemo(new Uint8Array(readFileSync(oldPath)))).demo;
const oldPackets = oldVoicePackets(old);
const pcm = emulatorDecoder(asi).decodeAll(oldPackets);
type B = { frames: Uint8Array[]; times: number[]; slot: number };
const bySlot = new Map<number, B[]>();
newPackets.forEach((p, i) => {
  const sv = parsed[i]; if (!sv) return;
  const opus = sv.chunks.find((c: any) => c.kind === 'opus') as any; if (!opus) return;
  const list = bySlot.get(p.slot) ?? (bySlot.set(p.slot, []).get(p.slot)!);
  let cur = list[list.length - 1];
  if (!cur || (cur as any).ended) { cur = { frames: [], times: [], slot: p.slot }; list.push(cur); }
  cur.frames.push(...opus.frames.map((f: any) => f.data)); cur.times.push(p.time);
  if (opus.endOfBurst) (cur as any).ended = true;
});
const oldBySlot = new Map<number, { audio: Int16Array; start: number }[]>();
{
  const open = new Map<number, { parts: Int16Array[]; start: number; last: number }>();
  const flush = (slot: number) => { const o = open.get(slot); if (!o) return; const n = o.parts.reduce((a, b) => a + b.length, 0); const a = new Int16Array(n); let at = 0; for (const x of o.parts) { a.set(x, at); at += x.length; } (oldBySlot.get(slot) ?? (oldBySlot.set(slot, []).get(slot)!)).push({ audio: a, start: o.start }); open.delete(slot); };
  oldPackets.forEach((p, i) => {
    if (!pcm[i].length) return;
    const o = open.get(p.slot);
    if (o && p.time >= o.last && p.time - o.last <= BURST_GAP_SECONDS) { o.parts.push(pcm[i]); o.last = p.time; }
    else { flush(p.slot); open.set(p.slot, { parts: [pcm[i]], start: p.time, last: p.time }); }
  });
  for (const s of [...open.keys()]) flush(s);
}
let bursts = 0, sigPow = 0, errPow = 0, startDiffMax = 0, lenDiffMax = 0, mismatch = 0;
for (const [slot, list] of bySlot) {
  const ol = oldBySlot.get(slot) ?? [];
  if (ol.length !== list.length) { mismatch++; continue; }
  list.forEach((b, k) => {
    const dec = decodeOpus(b.frames, 8000), src = ol[k].audio;
    bursts++;
    startDiffMax = Math.max(startDiffMax, Math.abs(b.times[0] - ol[k].start));
    lenDiffMax = Math.max(lenDiffMax, Math.abs(dec.length - src.length) / 8000);
    // Opus adds a small fixed delay; find it (0–10 ms) and measure the match.
    let best = { err: Infinity, sig: 1 };
    for (let d = 0; d <= 80; d++) {
      let s = 0, e = 0;
      for (let i = 0; i + d < dec.length && i < src.length; i += 2) { s += src[i] * src[i]; const v = dec[i + d] - src[i]; e += v * v; }
      if (e < best.err) best = { err: e, sig: s };
    }
    sigPow += best.sig; errPow += best.err;
  });
}
console.log(`${bursts} talk bursts compared (slots with different burst counts: ${mismatch}); start time differs ≤ ${startDiffMax.toFixed(3)} s; length differs ≤ ${(lenDiffMax * 1000).toFixed(0)} ms`);
console.log(`audio match (signal-to-difference ratio after Opus): ${(10 * Math.log10(sigPow / errPow)).toFixed(1)} dB`);
