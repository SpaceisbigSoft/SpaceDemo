import { DIRECTORY_ENTRY_SIZE, FrameType, HEADER_SIZE, type DemoFile, type DirectoryEntry, type Frame } from './types.js';

/** Default directory descriptions written by the engine. */
const DEFAULT_DESCRIPTIONS = ['LOADING', 'Playback'];

function frameSize(f: Frame): number {
  switch (f.type) {
    case FrameType.NetMessages:
    case FrameType.NetMessagesLoading:
      return 9 + f.info.length + 4 + f.messages.length;
    case FrameType.ConsoleCommand:
      return 9 + 64;
    default:
      return 9 + f.payload.length;
  }
}

function writeFrame(out: Uint8Array, view: DataView, at: number, f: Frame): number {
  view.setUint8(at, f.type);
  view.setFloat32(at + 1, f.time, true);
  view.setUint32(at + 5, f.index, true);
  let p = at + 9;
  switch (f.type) {
    case FrameType.NetMessages:
    case FrameType.NetMessagesLoading:
      out.set(f.info, p);
      p += f.info.length;
      view.setUint32(p, f.messages.length, true);
      p += 4;
      out.set(f.messages, p);
      return p + f.messages.length;
    case FrameType.ConsoleCommand:
      out.set(f.raw.subarray(0, 64), p);
      return p + 64;
    default:
      out.set(f.payload, p);
      return p + f.payload.length;
  }
}

export interface WriteOptions {
  /** Recount frames and durations for the directory instead of keeping the original values. */
  rebuildDirectory?: boolean;
}

/** Returns the sections with an end marker added to any section that lacks one (e.g. a recording that was cut off). */
function withEndMarkers(demo: DemoFile): DemoFile {
  const sections = demo.sections.map((s) => {
    const last = s.frames[s.frames.length - 1];
    if (!last || last.type === FrameType.SectionEnd) return s;
    const end: Frame = { type: FrameType.SectionEnd, time: last.time, index: last.index + 1, payload: new Uint8Array(0) };
    return { ...s, frames: [...s.frames, end] };
  });
  return { ...demo, sections };
}

/**
 * Serialises the model. A healthy demo read with `readDemo` and written unchanged comes back byte-identical.
 * Sections without an end marker get one, so cut-off recordings become playable.
 */
export function writeDemo(input: DemoFile, options: WriteOptions = {}): Uint8Array {
  const demo = withEndMarkers(input);
  const rebuild = options.rebuildDirectory || demo.recovered || demo.sections.some((s) => s.entry === null);
  const framesBytes = demo.sections.reduce((n, s) => n + s.frames.reduce((m, f) => m + frameSize(f), 0), 0);
  const dirOffset = HEADER_SIZE + framesBytes;
  const total = dirOffset + 4 + demo.sections.length * DIRECTORY_ENTRY_SIZE;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out.set(demo.header.raw.subarray(0, HEADER_SIZE), 0);
  view.setUint32(12, demo.header.networkProtocol, true);
  view.setUint32(536, demo.header.mapChecksum >>> 0, true);
  view.setUint32(540, dirOffset, true);

  const entries: DirectoryEntry[] = [];
  let p = HEADER_SIZE;
  demo.sections.forEach((s, i) => {
    const start = p;
    for (const f of s.frames) p = writeFrame(out, view, p, f);
    const last = s.frames[s.frames.length - 1];
    const keep = s.entry && !rebuild;
    entries.push({
      type: keep ? s.entry!.type : i === 0 ? 0 : 1,
      description: keep ? s.entry!.description : DEFAULT_DESCRIPTIONS[i] ?? `Section ${i}`,
      flags: keep ? s.entry!.flags : 0,
      cdTrack: keep ? s.entry!.cdTrack : -1,
      trackTime: keep ? s.entry!.trackTime : last && i > 0 ? last.time : 0,
      frameCount: keep ? s.entry!.frameCount : s.frames.filter((f) => f.type === FrameType.NetMessages).length,
      offset: start,
      length: p - start,
    });
  });

  view.setUint32(p, entries.length, true);
  p += 4;
  for (const e of entries) {
    view.setUint32(p, e.type, true);
    for (let i = 0; i < 64; i++) out[p + 4 + i] = i < e.description.length && i < 63 ? e.description.charCodeAt(i) : 0;
    view.setUint32(p + 68, e.flags, true);
    view.setInt32(p + 72, e.cdTrack, true);
    view.setFloat32(p + 76, e.trackTime, true);
    view.setUint32(p + 80, e.frameCount, true);
    view.setUint32(p + 84, e.offset, true);
    view.setUint32(p + 88, e.length, true);
    p += DIRECTORY_ENTRY_SIZE;
  }
  return out;
}
