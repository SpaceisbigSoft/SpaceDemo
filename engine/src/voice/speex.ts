// 2.17 Decoder for `voice_speex` (CS 1.6 era, 2003+): the official Xiph Speex narrowband decoder compiled to
// WebAssembly (helpers/speex/build.sh), so it runs the same everywhere with nothing to install. GoldSrc packs each
// voice packet as whole 20 ms frames (160 samples at 8 kHz) of a fixed size set by the quality in svc_voiceinit
// (Valve's VoiceEncoder_Speex maps voice quality 1–5 to Speex quality 2, 3, 4, 6, 8; frame bytes per Speex quality
// below). Measured on Set 3: voice quality 5 → 38-byte frames, quality 3 → 20-byte frames; packets of 1–4 frames.
// If the packets don't fit the announced quality, the frame size that fits them is used. One decoder per player slot,
// packets in demo order.
import type { OldVoiceDecoder } from './decoders.js';
import type { OldVoicePacket } from './restore.js';
import { SPEEX_WASM_BASE64 } from './speex-wasm.js';

/** Bytes per encoded frame for Speex qualities 0–10 (narrowband modes as Valve's encoder used them). */
export const SPEEX_FRAME_BYTES = [6, 6, 15, 15, 20, 20, 28, 28, 38, 38, 38];
export const SPEEX_FRAME_SAMPLES = 160;

/** Speex quality used for each GoldSrc voice quality 1–5. */
const SPEEX_QUALITY: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 6, 5: 8 };

/** Frame size for a GoldSrc voice quality (svc_voiceinit, 1–5; missing = 5). */
export function speexFrameBytes(voiceQuality = 5): number {
  return SPEEX_FRAME_BYTES[SPEEX_QUALITY[voiceQuality] ?? 8];
}

/** The frame size the packets themselves fit best (most packets a whole number of frames; larger wins a tie). */
export function frameBytesFromPackets(packets: OldVoicePacket[], fallback: number): number {
  const sizes = [...new Set(SPEEX_FRAME_BYTES)].sort((a, b) => b - a);
  const withData = packets.filter((p) => p.data.length > 0);
  if (!withData.length) return fallback;
  let best = fallback, bestFit = withData.filter((p) => p.data.length % fallback === 0).length;
  for (const size of sizes) {
    const fit = withData.filter((p) => p.data.length % size === 0).length;
    if (fit > bestFit) { best = size; bestFit = fit; }
  }
  return best;
}

interface SpeexExports {
  memory: WebAssembly.Memory;
  dec_new(): number;
  dec_free(p: number): void;
  dec_frame(p: number, data: number, len: number, out: number): number;
  dec_lost(p: number, out: number): number;
  buf(size: number): number;
  unbuf(p: number): void;
}

let module: WebAssembly.Module | undefined;
function instance(): SpeexExports {
  module ??= new WebAssembly.Module(Buffer.from(SPEEX_WASM_BASE64, 'base64'));
  return new WebAssembly.Instance(module, {}).exports as unknown as SpeexExports;
}

export interface SpeexStats {
  frames: number;
  /** Frames the decoder reported as corrupt (decoded as silence-filling "lost" frames instead). */
  corrupt: number;
  /** Packets whose length wasn't a whole number of frames (the rest was left out). */
  odd: number;
}

/** Decodes every packet in demo order; one PCM array (8 kHz, 16-bit) per packet. */
export function decodeSpeexPackets(packets: OldVoicePacket[], voiceQuality = 5, stats?: SpeexStats): Int16Array[] {
  const x = instance();
  const frameBytes = frameBytesFromPackets(packets, speexFrameBytes(voiceQuality));
  const inBuf = x.buf(frameBytes);
  const outBuf = x.buf(SPEEX_FRAME_SAMPLES * 2);
  const decoders = new Map<number, number>();
  const s = stats ?? { frames: 0, corrupt: 0, odd: 0 };
  const out: Int16Array[] = [];
  for (const p of packets) {
    const n = Math.floor(p.data.length / frameBytes);
    if (p.data.length % frameBytes) s.odd++;
    const pcm = new Int16Array(n * SPEEX_FRAME_SAMPLES);
    if (n > 0) {
      let d = decoders.get(p.slot);
      if (d === undefined) { d = x.dec_new(); decoders.set(p.slot, d); }
      for (let i = 0; i < n; i++) {
        new Uint8Array(x.memory.buffer, inBuf, frameBytes).set(p.data.subarray(i * frameBytes, (i + 1) * frameBytes));
        const r = x.dec_frame(d, inBuf, frameBytes, outBuf);
        if (r !== 0) { s.corrupt++; x.dec_lost(d, outBuf); }
        s.frames++;
        pcm.set(new Int16Array(x.memory.buffer, outBuf, SPEEX_FRAME_SAMPLES), i * SPEEX_FRAME_SAMPLES);
      }
    }
    out.push(pcm);
  }
  for (const d of decoders.values()) x.dec_free(d);
  return out;
}

/** The built-in Speex decoder in the shape the voice restore step expects. */
export function speexDecoder(voiceQuality = 5): OldVoiceDecoder & { stats: SpeexStats } {
  const stats: SpeexStats = { frames: 0, corrupt: 0, odd: 0 };
  return { name: 'Speex (built in, Xiph libspeex)', stats, decodeAll: (packets) => decodeSpeexPackets(packets, voiceQuality, stats) };
}
