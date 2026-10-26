// GoldSrc .dem container: header, directory and frames.
// Layout from compLexity Demo Player (GPL v3) and the talent demo-structure notes.

export const HEADER_SIZE = 544;
const DIR_ENTRY_SIZE = 92;

export interface DemoHeader {
  magic: string;
  demoProtocol: number;
  networkProtocol: number;
  mapName: string;
  gameDir: string;
  mapChecksum: number;
  directoryOffset: number;
}

export interface DirectoryEntry {
  type: number;
  description: string;
  flags: number;
  cdTrack: number;
  trackTime: number;
  frameCount: number;
  offset: number;
  fileLength: number;
}

export const FrameType = {
  GameDataLoading: 0,
  GameData: 1,
  DemoStart: 2,
  ConsoleCommand: 3,
  ClientData: 4,
  NextSection: 5,
  Event: 6,
  WeaponAnim: 7,
  Sound: 8,
  DemoBuffer: 9,
} as const;

export interface Frame {
  type: number;
  time: number;
  number: number;
  /** File offset of the frame header. */
  offset: number;
  /** For game data frames: the network message bytes. */
  messages?: Uint8Array;
  /** For console command frames: the command text. */
  command?: string;
}

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const z = slice.indexOf(0);
  return slice.subarray(0, z < 0 ? slice.length : z).toString('latin1');
}

export function readHeader(buf: Buffer): DemoHeader {
  if (buf.length < HEADER_SIZE) throw new Error('File is too small to be a demo');
  return {
    magic: cstr(buf, 0, 8),
    demoProtocol: buf.readUInt32LE(8),
    networkProtocol: buf.readUInt32LE(12),
    mapName: cstr(buf, 16, 260),
    gameDir: cstr(buf, 276, 260),
    mapChecksum: buf.readUInt32LE(536),
    directoryOffset: buf.readUInt32LE(540),
  };
}

/** Returns the directory entries, or null when the directory is missing or unreadable (e.g. crashed recording). */
export function readDirectory(buf: Buffer, header: DemoHeader): DirectoryEntry[] | null {
  const off = header.directoryOffset;
  if (off === 0 || off + 4 > buf.length) return null;
  const n = buf.readUInt32LE(off);
  if (n < 1 || n > 1024 || off + 4 + n * DIR_ENTRY_SIZE > buf.length) return null;
  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < n; i++) {
    const o = off + 4 + i * DIR_ENTRY_SIZE;
    entries.push({
      type: buf.readUInt32LE(o),
      description: cstr(buf, o + 4, 64),
      flags: buf.readUInt32LE(o + 68),
      cdTrack: buf.readInt32LE(o + 72),
      trackTime: buf.readFloatLE(o + 76),
      frameCount: buf.readUInt32LE(o + 80),
      offset: buf.readUInt32LE(o + 84),
      fileLength: buf.readUInt32LE(o + 88),
    });
  }
  return entries;
}

export function gameDataHeaderSize(networkProtocol: number): number {
  return networkProtocol <= 43 ? 560 : 464;
}

export interface FrameScanResult {
  frames: Frame[];
  /** Set if scanning stopped early (truncated or corrupt data). */
  error?: string;
  /** File offset where scanning stopped. */
  endOffset: number;
}

/**
 * Reads frames sequentially from `start` until a NextSection frame (or end of data).
 * Tolerant: a truncated final frame ends the scan with an error message instead of throwing.
 */
export function scanFrames(buf: Buffer, start: number, networkProtocol: number, limit = buf.length): FrameScanResult {
  const frames: Frame[] = [];
  let p = start;
  const gdh = gameDataHeaderSize(networkProtocol);
  try {
    while (p + 9 <= limit) {
      const offset = p;
      const type = buf.readUInt8(p);
      const time = buf.readFloatLE(p + 1);
      const number = buf.readUInt32LE(p + 5);
      p += 9;
      const frame: Frame = { type, time, number, offset };
      switch (type) {
        case FrameType.GameDataLoading:
        case FrameType.GameData: {
          if (p + gdh + 4 > limit) throw new Error('truncated game data header');
          p += gdh;
          const len = buf.readUInt32LE(p);
          p += 4;
          if (len > 65536 || p + len > limit) throw new Error(`bad game data length ${len}`);
          frame.messages = buf.subarray(p, p + len);
          p += len;
          break;
        }
        case FrameType.DemoStart:
          break;
        case FrameType.ConsoleCommand:
          frame.command = cstr(buf, p, 64);
          p += 64;
          break;
        case FrameType.ClientData:
          p += 32;
          break;
        case FrameType.NextSection:
          frames.push(frame);
          return { frames, endOffset: p };
        case FrameType.Event:
          p += 84;
          break;
        case FrameType.WeaponAnim:
          p += 8;
          break;
        case FrameType.Sound: {
          // int channel, int length, sample name[length], float volume, float attenuation, int flags, int pitch
          const len = buf.readInt32LE(p + 4);
          if (len < 0 || len > 255) throw new Error(`bad sound frame length ${len}`);
          p += 24 + len;
          break;
        }
        case FrameType.DemoBuffer: {
          const len = buf.readInt32LE(p);
          if (len < 0 || len > 32768) throw new Error(`bad demo buffer length ${len}`);
          p += 4 + len;
          break;
        }
        default:
          throw new Error(`unknown frame type ${type}`);
      }
      if (p > limit) throw new Error('frame runs past end of data');
      frames.push(frame);
    }
    return { frames, endOffset: p, error: p < limit ? 'trailing bytes' : 'no NextSection frame (truncated?)' };
  } catch (e) {
    return { frames, endOffset: p, error: (e as Error).message };
  }
}
