// Put old voice back into a converted (protocol 48) demo as Steam voice (plan 2.8, decision D5 = A).
// The old packets (Miles VR12 in CS 1.0–1.5 demos) are decoded by an OldVoiceDecoder (decoders.ts) into 8 kHz PCM,
// each talk burst is encoded as one Opus stream (libopus via WebAssembly, `opusscript`) and its frames are shared out
// over the burst's original packets in step with the audio each packet carried, so the voice stays where it was.
// The last packet of a burst carries the end-of-burst marker. The recorder's own empty packets are dropped.

import { createRequire } from 'node:module';
import type { DemoFile } from '../container/types.js';
import { replaceVoice } from '../transforms/replace-voice.js';
import { opusVoicePacket, type OpusFrame } from './steam-voice.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpusScript = require('opusscript') as typeof import('opusscript');

/** Old voice is 8 kHz 16-bit mono. */
export const OLD_VOICE_RATE = 8000;
/** Today's game decodes Steam voice at 24 kHz; an Opus stream made from 8 kHz audio plays fine at that rate. */
export const STEAM_VOICE_RATE = 24000;
const FRAME_MS = 20;
const FRAME_SAMPLES = (OLD_VOICE_RATE * FRAME_MS) / 1000; // 160
/** A talk burst ends after this much silence (or when the demo clock jumps back: each section restarts it). */
export const BURST_GAP_SECONDS = 0.3;
const OPUS_BITRATE = 24000;

export interface OldVoicePacket {
  /** Position among all voice messages of the demo (in demo order). */
  index: number;
  slot: number;
  time: number;
  data: Uint8Array;
}

/** All voice messages of a protocol-48 demo, in demo order. */
export function oldVoicePackets(demo: DemoFile): OldVoicePacket[] {
  const out: OldVoicePacket[] = [];
  replaceVoice(demo, ({ slot, time, data }) => (out.push({ index: out.length, slot, time, data }), data));
  return out;
}

/** Optional processing of the decoded audio before encoding (e.g. the "voice cleanup" setting). */
export type PcmFilter = (pcm: Int16Array, rate: number) => Int16Array;

export interface RestoreReport {
  bursts: number;
  /** Packets that now carry the original voice as Steam voice. */
  replaced: number;
  /** Empty packets dropped (the recorder's own "I am talking" packets carry no audio). */
  emptyDropped: number;
  /** Packets whose audio went out with the next packet of the burst (less than one Opus frame so far). */
  folded: number;
  /** Seconds of voice. */
  seconds: number;
}

/**
 * Replaces every voice packet with Steam voice made from `pcm` (one Int16Array per packet of `oldVoicePackets`, same
 * order; empty = no audio). `steamIdOf` gives each slot a stable fake SteamID (the game only uses it to tell talkers apart).
 */
export interface RestoreOptions {
  filter?: PcmFilter;
  /** Audio to send instead of each talk burst's decoded audio (same order as talkBursts(); e.g. AI-enhanced voice,
   * 5.g4), at `rate`, and as long as the burst (burst samples × rate / 8000). The filter is not applied to these. */
  replacement?: Int16Array[];
  /** Rate the replacement audio is encoded at (default 8000). */
  rate?: 8000 | 24000;
}

/** Talk bursts: per player slot, packets with audio at most BURST_GAP_SECONDS apart (indexes into the packet list). */
export function talkBursts(packets: OldVoicePacket[], pcm: Int16Array[]): number[][] {
  const bursts: number[][] = [];
  const open = new Map<number, { burst: number[]; last: number }>();
  for (const p of packets) {
    if (pcm[p.index].length === 0) continue;
    const cur = open.get(p.slot);
    if (cur && p.time >= cur.last && p.time - cur.last <= BURST_GAP_SECONDS) {
      cur.burst.push(p.index);
      cur.last = p.time;
    } else {
      const burst = [p.index];
      bursts.push(burst);
      open.set(p.slot, { burst, last: p.time });
    }
  }
  return bursts;
}

/** The decoded audio of one talk burst, end to end. */
export function burstAudio(burst: number[], pcm: Int16Array[]): Int16Array {
  const audio = new Int16Array(burst.reduce((n, i) => n + pcm[i].length, 0));
  let at = 0;
  for (const i of burst) { audio.set(pcm[i], at); at += pcm[i].length; }
  return audio;
}

export function restoreVoice(demo: DemoFile, pcm: Int16Array[], options: RestoreOptions = {}): { demo: DemoFile; report: RestoreReport } {
  const packets = oldVoicePackets(demo);
  if (packets.length !== pcm.length) throw new Error(`The demo has ${packets.length} voice packets but ${pcm.length} decoded ones were given.`);
  const report: RestoreReport = { bursts: 0, replaced: 0, emptyDropped: 0, folded: 0, seconds: 0 };

  const bursts = talkBursts(packets, pcm);
  report.bursts = bursts.length;

  // Encode each burst; share its frames out over its packets.
  const framesFor = new Map<number, { frames: Uint8Array[]; end: boolean }>();
  const rate = options.replacement ? options.rate ?? OLD_VOICE_RATE : OLD_VOICE_RATE;
  if (options.replacement && options.replacement.length !== bursts.length) throw new Error(`${bursts.length} talk bursts but ${options.replacement.length} replacements.`);
  bursts.forEach((b, bi) => {
    const total = b.reduce((n, i) => n + pcm[i].length, 0);
    let audio = options.replacement?.[bi] ?? burstAudio(b, pcm);
    if (options.filter && !options.replacement) audio = options.filter(audio, OLD_VOICE_RATE);
    report.seconds += total / OLD_VOICE_RATE;
    const frames = encodeOpus(audio, rate);
    let samples = 0, given = 0;
    b.forEach((i, k) => {
      samples += pcm[i].length;
      const last = k === b.length - 1;
      const upTo = last ? frames.length : Math.min(frames.length, Math.floor(samples / FRAME_SAMPLES));
      framesFor.set(i, { frames: frames.slice(given, upTo), end: last });
      given = upTo;
    });
  });

  const sequence = new Map<number, number>();
  let index = 0;
  const { demo: out } = replaceVoice(demo, ({ slot }) => {
    const i = index++;
    const mine = framesFor.get(i);
    if (!mine) { report.emptyDropped++; return null; }
    if (mine.frames.length === 0 && !mine.end) { report.folded++; return null; }
    const frames: OpusFrame[] = mine.frames.map((data) => {
      const seq = sequence.get(slot) ?? 0;
      sequence.set(slot, seq + 1);
      return { sequence: seq, data };
    });
    report.replaced++;
    return opusVoicePacket(76561197960265728n + BigInt(slot + 1), STEAM_VOICE_RATE, frames, mine.end);
  });
  report.seconds = Math.round(report.seconds * 10) / 10;
  return { demo: out, report };
}

/** PCM (8 or 24 kHz) → Opus packets of 20 ms (voice mode). The last frame is padded with silence. */
export function encodeOpus(pcm: Int16Array, rate: 8000 | 24000 = OLD_VOICE_RATE): Uint8Array[] {
  const enc = new OpusScript(rate, 1, OpusScript.Application.VOIP);
  const size = (rate * FRAME_MS) / 1000;
  try {
    enc.setBitrate(OPUS_BITRATE);
    const out: Uint8Array[] = [];
    for (let p = 0; p < pcm.length; p += size) {
      const frame = new Int16Array(size);
      frame.set(pcm.subarray(p, Math.min(pcm.length, p + size)));
      out.push(new Uint8Array(enc.encode(Buffer.from(frame.buffer), size)));
    }
    return out;
  } finally {
    enc.delete();
  }
}

/** Opus packets → PCM at `rate` (for checks: what the game will hear). */
export function decodeOpus(packets: Uint8Array[], rate: 8000 | 24000 = STEAM_VOICE_RATE): Int16Array {
  const dec = new OpusScript(rate, 1, OpusScript.Application.VOIP);
  try {
    const parts = packets.map((p) => { const b = dec.decode(Buffer.from(p)); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2).slice(); });
    const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  } finally {
    dec.delete();
  }
}
