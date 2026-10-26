// Steam voice packets as carried in svc_voicedata by today's CS 1.6 (build 10210).
// Layout (measured from a demo recorded on build 10210, see docs/FORMAT.md):
//   SteamID (u64) · one or more chunks · CRC-32 of everything before it (u32)
//   chunk 0x0B  sample rate (u16)
//   chunk 0x00  silence: number of silent samples (u16)
//   chunk 0x06  Opus frames: byte length (u16), then frames of [length u16][sequence u16][Opus packet];
//               a lone 0xFFFF (2 bytes) ends a talk burst.
import { crc32 } from '../crc32.js';

export interface OpusFrame {
  sequence: number;
  /** One Opus packet (20 ms). */
  data: Uint8Array;
}

export type VoiceChunk =
  | { kind: 'sampleRate'; rate: number }
  | { kind: 'silence'; samples: number }
  | { kind: 'opus'; frames: OpusFrame[]; endOfBurst: boolean };

export interface SteamVoicePacket {
  steamId: bigint;
  chunks: VoiceChunk[];
}

export class VoicePacketError extends Error {}

const TYPE = { sampleRate: 0x0b, silence: 0x00, opus: 0x06 } as const;

export function parseSteamVoice(bytes: Uint8Array): SteamVoicePacket {
  if (bytes.length < 8 + 4) throw new VoicePacketError('Voice packet too short');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 4;
  if (crc32(bytes.subarray(0, end)) !== v.getUint32(end, true)) throw new VoicePacketError('Voice packet checksum mismatch');
  const packet: SteamVoicePacket = { steamId: v.getBigUint64(0, true), chunks: [] };
  let p = 8;
  while (p < end) {
    const type = bytes[p++];
    if (type === TYPE.sampleRate) {
      packet.chunks.push({ kind: 'sampleRate', rate: v.getUint16(p, true) });
      p += 2;
    } else if (type === TYPE.silence) {
      packet.chunks.push({ kind: 'silence', samples: v.getUint16(p, true) });
      p += 2;
    } else if (type === TYPE.opus) {
      const stop = p + 2 + v.getUint16(p, true);
      let q = p + 2;
      const chunk: VoiceChunk = { kind: 'opus', frames: [], endOfBurst: false };
      while (q + 2 <= stop) {
        const frameLen = v.getUint16(q, true);
        if (frameLen === 0xffff) {
          chunk.endOfBurst = true;
          q += 2;
          break;
        }
        if (q + 4 + frameLen > stop) throw new VoicePacketError('Opus frame runs past its chunk');
        chunk.frames.push({ sequence: v.getUint16(q + 2, true), data: bytes.slice(q + 4, q + 4 + frameLen) });
        q += 4 + frameLen;
      }
      if (q !== stop) throw new VoicePacketError('Unexpected bytes after the Opus frames');
      packet.chunks.push(chunk);
      p = stop;
    } else throw new VoicePacketError(`Unknown voice chunk type ${type}`);
  }
  return packet;
}

function chunkSize(c: VoiceChunk): number {
  if (c.kind !== 'opus') return 3;
  return 3 + c.frames.reduce((n, f) => n + 4 + f.data.length, 0) + (c.endOfBurst ? 2 : 0);
}

export function buildSteamVoice(packet: SteamVoicePacket): Uint8Array {
  const out = new Uint8Array(8 + packet.chunks.reduce((n, c) => n + chunkSize(c), 0) + 4);
  const v = new DataView(out.buffer);
  v.setBigUint64(0, packet.steamId, true);
  let p = 8;
  for (const c of packet.chunks) {
    if (c.kind === 'sampleRate' || c.kind === 'silence') {
      out[p] = TYPE[c.kind];
      v.setUint16(p + 1, c.kind === 'sampleRate' ? c.rate : c.samples, true);
      p += 3;
      continue;
    }
    out[p] = TYPE.opus;
    v.setUint16(p + 1, chunkSize(c) - 3, true);
    p += 3;
    for (const f of c.frames) {
      v.setUint16(p, f.data.length, true);
      v.setUint16(p + 2, f.sequence & 0xffff, true);
      out.set(f.data, p + 4);
      p += 4 + f.data.length;
    }
    if (c.endOfBurst) {
      v.setUint16(p, 0xffff, true);
      p += 2;
    }
  }
  v.setUint32(p, crc32(out.subarray(0, p)), true);
  return out;
}

/** Convenience: a packet carrying Opus frames at the given sample rate (what the game sends while someone talks). */
export function opusVoicePacket(steamId: bigint, sampleRate: number, frames: OpusFrame[], endOfBurst = false): Uint8Array {
  return buildSteamVoice({ steamId, chunks: [{ kind: 'sampleRate', rate: sampleRate }, { kind: 'opus', frames, endOfBurst }] });
}
