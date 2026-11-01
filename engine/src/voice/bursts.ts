// 5.v A demo's original voice as talk bursts: per player, the voice packets less than BURST_GAP apart, decoded to 8 kHz
// PCM, with who talked and when. Miles voice (2002) needs a decoder (the user's own mssvoice.asi through our helper);
// Speex is decoded by the built-in decoder.
import type { DemoFile } from '../container/types.js';
import { voiceCodecOf, voiceQualityOf } from '../fix/fix.js';
import { extractMatch } from '../match/extract.js';
import { upgradeTo48 } from '../transforms/upgrade-to-48.js';
import type { OldVoiceDecoder } from './decoders.js';
import { oldVoicePackets } from './restore.js';
import { speexDecoder } from './speex.js';

/** Packets further apart than this start a new burst. */
export const BURST_GAP = 0.3;
/** Bursts shorter than this (a click of the push-to-talk key) are left out. */
export const MIN_BURST = 0.4;

export interface TalkBurst {
  slot: number;
  /** Player name (the connection in that slot at that time), if known. */
  player?: string;
  /** Demo seconds. */
  start: number;
  end: number;
  /** 8 kHz mono. */
  pcm: Int16Array;
}

export interface TalkBurstsResult {
  codec?: string;
  bursts: TalkBurst[];
  /** Why there are none, in plain words. */
  note?: string;
}

export function talkBursts(demo: DemoFile, decoder?: OldVoiceDecoder): TalkBurstsResult {
  const codec = voiceCodecOf(demo);
  const cur = demo.header.networkProtocol === 48 ? demo : upgradeTo48(demo, { isResourceMissing: () => false }).demo;
  const packets = oldVoicePackets(cur).filter((p) => p.data.length > 0);
  if (!packets.length) return { codec, bursts: [], note: 'This demo has no voice recorded in it.' };
  let dec: OldVoiceDecoder | undefined;
  if (codec === 'voice_speex') dec = speexDecoder(voiceQualityOf(demo) ?? 5);
  else if (codec === 'voice_miles') dec = decoder;
  if (!dec) {
    return { codec, bursts: [], note: codec === 'voice_miles' ? 'The 2002 voice needs the game\'s voice file (mssvoice.asi) and our voice helper to be read.' : `Voice "${codec ?? 'unknown'}" can't be turned into text yet.` };
  }
  const pcm = dec.decodeAll(packets);
  const m = extractMatch(demo);
  const nameAt = (slot: number, t: number) => {
    const vb = m.voice.find((v) => v.slot === slot && v.start <= t + 0.5 && v.end >= t - 0.5);
    const byBurst = m.players.find((p) => p.id === vb?.player)?.name;
    if (byBurst) return byBurst;
    const conns = m.players.filter((p) => p.slot === slot && !p.isHltv && (p.leftAt === undefined || p.leftAt >= t));
    return conns.at(-1)?.name || undefined;
  };
  const out: (TalkBurst & { parts: Int16Array[] })[] = [];
  const open = new Map<number, (typeof out)[number]>();
  packets.forEach((p, i) => {
    const b = open.get(p.slot);
    if (b && p.time - b.end <= BURST_GAP) { b.end = p.time; b.parts.push(pcm[i]); return; }
    const nb = { slot: p.slot, start: p.time, end: p.time, pcm: new Int16Array(0), parts: [pcm[i]] };
    out.push(nb);
    open.set(p.slot, nb);
  });
  const bursts: TalkBurst[] = [];
  for (const b of out) {
    const len = b.parts.reduce((a, x) => a + x.length, 0);
    if (len / 8000 < MIN_BURST) continue;
    const s = new Int16Array(len);
    let o = 0;
    for (const x of b.parts) { s.set(x, o); o += x.length; }
    bursts.push({ slot: b.slot, player: nameAt(b.slot, b.start), start: Math.round(b.start * 100) / 100, end: Math.round(b.end * 100) / 100, pcm: s });
  }
  return { codec, bursts };
}
