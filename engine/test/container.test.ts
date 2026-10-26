import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { writeDemo } from '../src/container/write.js';
import { FrameType, HEADER_SIZE, type DemoFile } from '../src/container/types.js';

/** Builds a small, valid protocol-48 demo in memory. */
function makeDemo(): DemoFile {
  const raw = new Uint8Array(HEADER_SIZE);
  raw.set([...'HLDEMO'].map((c) => c.charCodeAt(0)), 0);
  new DataView(raw.buffer).setUint32(8, 5, true);
  raw.set([...'de_test'].map((c) => c.charCodeAt(0)), 16);
  raw.set([...'cstrike'].map((c) => c.charCodeAt(0)), 276);
  const info = new Uint8Array(464).fill(7);
  return {
    header: { magic: 'HLDEMO', demoProtocol: 5, networkProtocol: 48, mapName: 'de_test', gameDir: 'cstrike', mapChecksum: 123, directoryOffset: 0, raw },
    recovered: false,
    problems: [],
    sections: [
      { entry: null, frames: [
        { type: FrameType.NetMessagesLoading, time: 0, index: 0, info, messages: Uint8Array.from([1, 1, 1]) },
        { type: FrameType.SectionEnd, time: 0, index: 1, payload: new Uint8Array(0) },
      ] },
      { entry: null, frames: [
        { type: FrameType.DemoStart, time: 0, index: 2, payload: new Uint8Array(0) },
        { type: FrameType.NetMessages, time: 0.5, index: 3, info, messages: Uint8Array.from([1, 7, 0, 0, 0, 0]) },
        { type: FrameType.ConsoleCommand, time: 0.6, index: 4, command: '+attack', raw: Uint8Array.from([...'+attack'].map((c) => c.charCodeAt(0)).concat(new Array(57).fill(0))) },
        { type: FrameType.NetMessages, time: 1.25, index: 5, info, messages: Uint8Array.from([1]) },
        { type: FrameType.SectionEnd, time: 1.25, index: 6, payload: new Uint8Array(0) },
      ] },
    ],
  };
}

describe('demo container', () => {
  it('writes a demo with a correct directory, and reads it back', () => {
    const bytes = writeDemo(makeDemo());
    const demo = readDemo(bytes);
    expect(demo.problems).toEqual([]);
    expect(demo.sections.map((s) => s.entry?.description)).toEqual(['LOADING', 'Playback']);
    expect(demo.sections[1].entry?.frameCount).toBe(2);
    expect(demo.sections[1].entry?.trackTime).toBeCloseTo(1.25);
    const cmd = demo.sections[1].frames[2];
    expect(cmd.type === FrameType.ConsoleCommand && cmd.command).toBe('+attack');
  });

  it('round-trips byte-for-byte', () => {
    const bytes = writeDemo(makeDemo());
    expect(Buffer.from(writeDemo(readDemo(bytes))).equals(Buffer.from(bytes))).toBe(true);
  });

  it('recovers a demo whose recording was cut off (no directory, truncated)', () => {
    const bytes = writeDemo(makeDemo());
    const crashed = bytes.slice(0, bytes.length - 4 - 2 * 92 - 9 - 5); // drop directory, last end marker and part of a frame
    new DataView(crashed.buffer).setUint32(540, 0, true);
    const demo = readDemo(crashed);
    expect(demo.recovered).toBe(true);
    expect(demo.problems.join(' ')).toMatch(/no directory/);
    expect(demo.sections.length).toBe(2);
    // The rebuilt file is readable without problems.
    expect(readDemo(writeDemo(demo)).problems).toEqual([]);
  });

  it('rejects files that are not demos', () => {
    expect(() => readDemo(new Uint8Array(600))).toThrow(/Not a GoldSrc demo/);
  });
});
