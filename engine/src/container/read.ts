import { ByteReader } from '../binary/byte-reader.js';
import { FormatError, OutOfDataError } from '../binary/errors.js';
import {
  DIRECTORY_ENTRY_SIZE,
  FrameType,
  HEADER_SIZE,
  MAX_DIRECTORY_ENTRIES,
  netInfoSize,
  type DemoFile,
  type DemoHeader,
  type DirectoryEntry,
  type Frame,
  type Section,
} from './types.js';

export function readHeader(bytes: Uint8Array): DemoHeader {
  if (bytes.length < HEADER_SIZE) throw new FormatError(`File is too small to be a demo (${bytes.length} bytes)`);
  const r = new ByteReader(bytes);
  const header: DemoHeader = {
    magic: r.fixedString(8),
    demoProtocol: r.u32(),
    networkProtocol: r.u32(),
    mapName: r.fixedString(260),
    gameDir: r.fixedString(260),
    mapChecksum: r.u32(),
    directoryOffset: r.u32(),
    raw: bytes.slice(0, HEADER_SIZE),
  };
  if (header.magic !== 'HLDEMO') throw new FormatError(`Not a GoldSrc demo (file starts with "${header.magic}")`);
  if (header.demoProtocol !== 5) throw new FormatError(`Unsupported demo protocol ${header.demoProtocol} (expected 5)`);
  return header;
}

function readDirectory(bytes: Uint8Array, offset: number): DirectoryEntry[] | string {
  if (offset === 0) return 'The demo has no directory (the game probably closed or crashed while recording).';
  if (offset < HEADER_SIZE || offset + 4 > bytes.length) return `The directory offset (${offset}) points outside the file.`;
  const r = new ByteReader(bytes, offset);
  const count = r.u32();
  if (count < 1 || count > MAX_DIRECTORY_ENTRIES || offset + 4 + count * DIRECTORY_ENTRY_SIZE > bytes.length) {
    return `The directory is damaged (it claims ${count} entries).`;
  }
  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e: DirectoryEntry = {
      type: r.u32(),
      description: r.fixedString(64),
      flags: r.u32(),
      cdTrack: r.i32(),
      trackTime: r.f32(),
      frameCount: r.u32(),
      offset: r.u32(),
      length: r.u32(),
    };
    if (e.offset < HEADER_SIZE || e.offset > offset) return `Directory entry "${e.description}" points outside the frame data.`;
    entries.push(e);
  }
  return entries;
}

/** Reads one frame at `r.offset`. Throws OutOfDataError/FormatError if the frame is incomplete or invalid. */
function readFrame(r: ByteReader, networkProtocol: number, limit: number): Frame {
  const type = r.u8();
  const time = r.f32();
  const index = r.u32();
  switch (type) {
    case FrameType.NetMessages:
    case FrameType.NetMessagesLoading: {
      const info = r.bytesView(netInfoSize(networkProtocol), 'frame info');
      const length = r.u32();
      if (length > 65536) throw new FormatError(`Network message block is implausibly large (${length} bytes)`);
      return { type, time, index, info, messages: r.bytesView(length, 'network messages') };
    }
    case FrameType.ConsoleCommand: {
      const raw = r.bytesView(64, 'console command');
      const end = raw.indexOf(0);
      let command = '';
      for (const b of end < 0 ? raw : raw.subarray(0, end)) command += String.fromCharCode(b);
      return { type, time, index, command, raw };
    }
    case FrameType.DemoStart:
    case FrameType.SectionEnd:
      return { type, time, index, payload: new Uint8Array(0) };
    case FrameType.ClientData:
      return { type, time, index, payload: r.bytesView(32, 'client data') };
    case FrameType.Event:
      return { type, time, index, payload: r.bytesView(84, 'event') };
    case FrameType.WeaponAnimation:
      return { type, time, index, payload: r.bytesView(8, 'weapon animation') };
    case FrameType.Sound: {
      // channel (i32), sample name length (i32), name, attenuation (f32), volume (f32), flags (i32), pitch (i32)
      const start = r.offset;
      r.skip(4);
      const nameLength = r.i32();
      if (nameLength < 0 || nameLength > 255) throw new FormatError(`Sound frame has an invalid name length (${nameLength})`);
      r.offset = start;
      return { type, time, index, payload: r.bytesView(24 + nameLength, 'sound') };
    }
    case FrameType.DemoBuffer: {
      const start = r.offset;
      const length = r.i32();
      if (length < 0 || length > 32768) throw new FormatError(`Demo buffer frame has an invalid length (${length})`);
      r.offset = start;
      return { type, time, index, payload: r.bytesView(4 + length, 'demo buffer') };
    }
    default:
      throw new FormatError(`Unknown frame type ${type}`);
  }
  void limit;
}

interface ScanResult {
  frames: Frame[];
  endOffset: number;
  /** Set if scanning stopped because the data was damaged or ran out. */
  problem?: string;
  endedCleanly: boolean;
}

/**
 * Reads frames from `start`. With `stopAtSectionEnd`, stops after the first SectionEnd frame (used when the
 * directory is missing). Otherwise reads every frame up to `limit` (the directory's section length): some demos
 * contain extra SectionEnd frames inside a section, left over from map changes while recording.
 */
function scanSection(bytes: Uint8Array, start: number, limit: number, networkProtocol: number, stopAtSectionEnd: boolean): ScanResult {
  const view = bytes.subarray(0, limit);
  const r = new ByteReader(view, start);
  const frames: Frame[] = [];
  while (r.remaining > 0) {
    const frameStart = r.offset;
    try {
      const f = readFrame(r, networkProtocol, limit);
      frames.push(f);
      if (stopAtSectionEnd && f.type === FrameType.SectionEnd) return { frames, endOffset: r.offset, endedCleanly: true };
    } catch (e) {
      if (e instanceof OutOfDataError || e instanceof FormatError) {
        return { frames, endOffset: frameStart, endedCleanly: false, problem: `${e.message} (frame starting at byte ${frameStart})` };
      }
      throw e;
    }
  }
  const last = frames[frames.length - 1];
  if (!stopAtSectionEnd && last?.type === FrameType.SectionEnd) return { frames, endOffset: r.offset, endedCleanly: true };
  return { frames, endOffset: r.offset, endedCleanly: false, problem: 'The section has no end marker (recording was cut off).' };
}

/** Reads a whole demo into the typed model. Damaged demos are recovered as far as possible; see `problems`. */
export function readDemo(bytes: Uint8Array): DemoFile {
  const header = readHeader(bytes);
  const P = header.networkProtocol;
  const problems: string[] = [];
  const sections: Section[] = [];
  const directory = readDirectory(bytes, header.directoryOffset);

  if (typeof directory !== 'string') {
    for (const entry of directory) {
      const end = Math.min(entry.offset + entry.length, header.directoryOffset);
      const scan = scanSection(bytes, entry.offset, end, P, false);
      if (scan.problem) problems.push(`Section "${entry.description}": ${scan.problem}`);
      sections.push({ entry, frames: scan.frames });
    }
    return { header, sections, problems, recovered: false };
  }

  // No usable directory: scan the frame data from the end of the header. The first section end closes the
  // LOADING section; everything after it is the Playback section up to the end of the data. (Playback sections
  // can contain extra section-end frames left over from map loads, like healthy demos have; splitting there
  // would make the game stop early.)
  problems.push(directory);
  const loading = scanSection(bytes, HEADER_SIZE, bytes.length, P, true);
  if (loading.frames.length > 0) sections.push({ entry: null, frames: loading.frames });
  if (!loading.endedCleanly) {
    if (loading.problem) problems.push(loading.problem);
  } else if (loading.endOffset < bytes.length) {
    const playback = scanSection(bytes, loading.endOffset, bytes.length, P, false);
    if (playback.frames.length > 0) sections.push({ entry: null, frames: playback.frames });
    if (playback.problem) problems.push(playback.problem);
  }
  return { header, sections, problems, recovered: true };
}
