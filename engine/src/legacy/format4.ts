// Demo format 4 (Half-Life 1.0.x, 1999: network protocols 38-40). Plan F4; layout in docs/FORMAT.md ("Protocol 38-40").
// Header: like format 5 (544 bytes) from HL 1.0.1.0 on; HL 1.0.0.9 has a 280-byte header with 128-byte strings.
// Frames: type (1) time (f32) index (i32), then: 6 view (64 bytes), 3 sequence info (28), 0/1 net messages (24-byte
// info + u32 length + data, whose first 8 bytes are the netchan sequence/ack), 4 end of packet, 2 playback start,
// 5 console command (64), 8 section end.
import { ByteReader } from '../binary/byte-reader.js';
import { FormatError, OutOfDataError } from '../binary/errors.js';
import { DIRECTORY_ENTRY_SIZE, MAX_DIRECTORY_ENTRIES, type DirectoryEntry } from '../container/types.js';

export const enum Frame4Type {
  NetLoading = 0,
  Net = 1,
  PlaybackStart = 2,
  SequenceInfo = 3,
  PacketEnd = 4,
  ConsoleCommand = 5,
  View = 6,
  SectionEnd = 8,
}

export interface Demo4Header {
  demoProtocol: 4;
  networkProtocol: number;
  mapName: string;
  gameDir: string;
  mapChecksum: number;
  directoryOffset: number;
  headerSize: 280 | 544;
}

interface Frame4Base {
  time: number;
  index: number;
}
export interface NetFrame4 extends Frame4Base {
  type: Frame4Type.Net | Frame4Type.NetLoading;
  /** 24 bytes: for i = 0..2, view angle i then origin i (floats, interleaved). */
  info: Uint8Array;
  /** Message data without the 8-byte netchan header. */
  messages: Uint8Array;
}
export interface DataFrame4 extends Frame4Base {
  type: Frame4Type.View | Frame4Type.SequenceInfo | Frame4Type.ConsoleCommand;
  data: Uint8Array;
}
export interface EmptyFrame4 extends Frame4Base {
  type: Frame4Type.PlaybackStart | Frame4Type.PacketEnd | Frame4Type.SectionEnd;
}
export type Frame4 = NetFrame4 | DataFrame4 | EmptyFrame4;

export interface Demo4 {
  header: Demo4Header;
  sections: { entry: DirectoryEntry | null; frames: Frame4[] }[];
  problems: string[];
}

const DATA_SIZE: Partial<Record<number, number>> = { [Frame4Type.View]: 64, [Frame4Type.SequenceInfo]: 28, [Frame4Type.ConsoleCommand]: 64 };

function printable(b: Uint8Array, at: number): boolean {
  const end = b.indexOf(0, at);
  if (end <= at || end - at > 32) return false;
  for (let i = at; i < end; i++) if (b[i] < 0x21 || b[i] > 0x7e) return false;
  return true;
}

/** True for a demo-format-4 file (HLDEMO, demo protocol 4). */
export function isFormat4(bytes: Uint8Array): boolean {
  if (bytes.length < 280) return false;
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  return magic === 'HLDEMO' && new DataView(bytes.buffer, bytes.byteOffset, 16).getUint32(8, true) === 4;
}

export function readHeader4(bytes: Uint8Array): Demo4Header {
  if (!isFormat4(bytes)) throw new FormatError('Not a demo-format-4 (1999) demo');
  const r = new ByteReader(bytes);
  r.skip(12);
  const networkProtocol = r.u32();
  // 544-byte header: the game folder name starts at 276. HL 1.0.0.9's 280-byte header has it at 144.
  const long = bytes.length >= 544 && printable(bytes, 276);
  const strLen = long ? 260 : 128;
  const mapName = r.fixedString(strLen);
  const gameDir = r.fixedString(strLen);
  const mapChecksum = r.u32();
  const directoryOffset = r.u32();
  return { demoProtocol: 4, networkProtocol, mapName, gameDir, mapChecksum, directoryOffset, headerSize: long ? 544 : 280 };
}

function readFrames(bytes: Uint8Array, start: number, end: number, problems: string[]): Frame4[] {
  const r = new ByteReader(bytes.subarray(0, end), start);
  const frames: Frame4[] = [];
  while (r.remaining > 0) {
    const at = r.offset;
    try {
      const type = r.u8();
      const time = r.f32();
      const index = r.i32();
      if (type === Frame4Type.Net || type === Frame4Type.NetLoading) {
        const info = r.bytesView(24, 'frame info');
        const length = r.u32();
        if (length < 8 || length > 65536) throw new FormatError(`Network message block has an implausible size (${length} bytes)`);
        const data = r.bytesView(length, 'network messages');
        frames.push({ type, time, index, info, messages: data.subarray(8) });
      } else if (DATA_SIZE[type] !== undefined) {
        frames.push({ type: type as DataFrame4['type'], time, index, data: r.bytesView(DATA_SIZE[type]!, 'frame data') });
      } else if (type === Frame4Type.PlaybackStart || type === Frame4Type.PacketEnd || type === Frame4Type.SectionEnd) {
        frames.push({ type, time, index });
      } else throw new FormatError(`Unknown frame type ${type}`);
    } catch (e) {
      if (e instanceof OutOfDataError || e instanceof FormatError) {
        problems.push(`${e.message} (frame starting at byte ${at})`);
        break;
      }
      throw e;
    }
  }
  return frames;
}

/** Reads a format-4 demo. Without a usable directory, all frames are read and split where playback starts. */
export function readDemo4(bytes: Uint8Array): Demo4 {
  const header = readHeader4(bytes);
  const problems: string[] = [];
  const d = header.directoryOffset;
  const r = new ByteReader(bytes);
  if (d >= header.headerSize && d + 4 <= bytes.length) {
    r.offset = d;
    const count = r.u32();
    if (count >= 1 && count <= MAX_DIRECTORY_ENTRIES && d + 4 + count * DIRECTORY_ENTRY_SIZE <= bytes.length) {
      const sections: Demo4['sections'] = [];
      for (let i = 0; i < count; i++) {
        const entry: DirectoryEntry = { type: r.u32(), description: r.fixedString(64), flags: r.u32(), cdTrack: r.i32(), trackTime: r.f32(), frameCount: r.u32(), offset: r.u32(), length: r.u32() };
        const end = Math.min(entry.offset + entry.length, d);
        sections.push({ entry, frames: readFrames(bytes, entry.offset, end, problems) });
      }
      return { header, sections, problems };
    }
  }
  problems.push('The demo has no usable directory (the game probably closed or crashed while recording).');
  const frames = readFrames(bytes, header.headerSize, bytes.length, problems);
  const start = frames.findIndex((f) => f.type === Frame4Type.PlaybackStart);
  const sections = start > 0 ? [{ entry: null, frames: frames.slice(0, start) }, { entry: null, frames: frames.slice(start) }] : [{ entry: null, frames }];
  return { header, sections, problems };
}
