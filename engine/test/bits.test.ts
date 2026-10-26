import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from '../src/binary/bits.js';

describe('BitReader / BitWriter', () => {
  it('reads bits least-significant first', () => {
    const r = new BitReader(Uint8Array.from([0b1010_0101, 0xff]));
    expect(r.bits(1)).toBe(1);
    expect(r.bits(2)).toBe(0b10);
    expect(r.bits(5)).toBe(0b10100);
    expect(r.u8()).toBe(0xff);
    expect(r.atEnd).toBe(true);
  });

  it('round-trips values of every width, unaligned', () => {
    const w = new BitWriter();
    const values: [number, number][] = [];
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 2000; i++) {
      const n = (rand() % 32) + 1;
      const v = rand() % 2 ** Math.min(n, 31) + (n === 32 && rand() % 2 ? 2 ** 31 : 0);
      values.push([v, n]);
      w.bits(v, n);
    }
    const r = new BitReader(w.finish());
    for (const [v, n] of values) expect(r.bits(n)).toBe(v);
  });

  it('handles signed values and strings', () => {
    const w = new BitWriter();
    w.bool(true);
    w.bits(-5 & 0xff, 8);
    w.string('de_train');
    w.fixedString('abc', 6);
    const r = new BitReader(w.finish());
    expect(r.bool()).toBe(true);
    expect(r.i8()).toBe(-5);
    expect(r.string()).toBe('de_train');
    expect(r.fixedString(6)).toBe('abc');
  });

  it('reports running out of data clearly', () => {
    const r = new BitReader(Uint8Array.from([1]));
    expect(() => r.u16()).toThrow(/Ran out of data/);
  });
});
