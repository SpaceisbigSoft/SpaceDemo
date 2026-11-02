// Plan 2.19: protocol 43 (CS 1.0-1.2) bit order, frame info and CS 1.0 animation numbers.
import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter, replayBits } from '../src/binary/bits.js';
import { convertInfo43, upgradePlayerSequence } from '../src/transforms/upgrade-to-48.js';

describe('protocol 43 bit order', () => {
  it('reads MSB-first and writes the same fields again LSB-first', () => {
    // MSB-first: 101 (5, 3 bits) then 00001 (1, 5 bits) then 11110000 (0xf0, 8 bits)
    const r = new BitReader(Uint8Array.of(0b10100001, 0b11110000));
    r.msbFirst = true;
    r.log = [];
    expect(r.bits(3)).toBe(5);
    expect(r.bits(5)).toBe(1);
    expect(r.u8()).toBe(0xf0);
    const w = new BitWriter();
    replayBits(w, r.log);
    const back = new BitReader(w.finish());
    expect([back.bits(3), back.bits(5), back.u8()]).toEqual([5, 1, 0xf0]);
  });
  it('forgets reads undone by seekBit and does not log dropped bits', () => {
    const r = new BitReader(Uint8Array.of(0xff, 0x00, 0xaa));
    r.msbFirst = true;
    r.log = [];
    const mark = r.bitOffset;
    r.u16();
    r.seekBit(mark);
    r.dropBits(1);
    r.bits(7);
    expect(r.log.map((x) => x.n)).toEqual([7]);
  });
});

describe('protocol 43 frame info (560 → 464 bytes)', () => {
  it('keeps ref_params up to 212, moves the user command, view and sequence info', () => {
    const info = new Uint8Array(560).map((_, i) => (i % 251) + 1);
    const out = convertInfo43(info);
    expect(out.length).toBe(464);
    expect(out.subarray(0, 212)).toEqual(info.subarray(0, 212));
    expect(out.subarray(212, 236).every((b) => b === 0)).toBe(true);
    expect(out.subarray(236, 288)).toEqual(info.subarray(212, 264));
    expect(out.subarray(420, 436)).toEqual(info.subarray(516, 532));
    expect(out.subarray(436)).toEqual(info.subarray(532));
    expect(convertInfo43(new Uint8Array(464)).length).toBe(464);
  });
});

describe('CS 1.0 player animation numbers', () => {
  it('maps 0-6 → 1-7, 7-79 → +3, 80+ → +19', () => {
    expect(upgradePlayerSequence(0, true)).toBe(1);
    expect(upgradePlayerSequence(6, true)).toBe(7);
    expect(upgradePlayerSequence(7, true)).toBe(10);
    expect(upgradePlayerSequence(79, true)).toBe(82);
    expect(upgradePlayerSequence(80, true)).toBe(99);
    expect(upgradePlayerSequence(83)).toBe(99);
  });
});
