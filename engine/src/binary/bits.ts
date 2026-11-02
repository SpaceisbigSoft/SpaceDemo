// Bit-level reader and writer used by GoldSrc network messages.
// Bits are packed least-significant-bit first within each byte (little-endian bit order).
import { OutOfDataError } from './errors.js';
import { latin1 } from './byte-reader.js';

/** One read made while a BitReader logs (protocol 43 transcoding): value of `n` bits read at bit `pos`. */
export interface BitRead {
  pos: number;
  n: number;
  value: number;
}

export class BitReader {
  private pos = 0; // in bits
  /**
   * Protocol 43 (Half-Life 1.1.0.4-1.1.0.7, CS 1.0-1.2) packs bits most-significant-first in its bit-packed messages;
   * later protocols pack least-significant-first. While true, `bits()` reads MSB-first.
   */
  msbFirst = false;
  /** While set, every read is recorded so the message can be written again LSB-first (see `replayBits`). */
  log?: BitRead[];

  constructor(readonly bytes: Uint8Array, startByte = 0) {
    this.pos = startByte * 8;
  }

  get bitOffset(): number {
    return this.pos;
  }
  get byteOffset(): number {
    return this.pos >>> 3;
  }
  get atEnd(): boolean {
    return this.pos >= this.bytes.length * 8;
  }
  get bitsLeft(): number {
    return this.bytes.length * 8 - this.pos;
  }

  private need(nBits: number, what: string): void {
    if (this.pos + nBits > this.bytes.length * 8) throw new OutOfDataError(what, this.byteOffset, Math.ceil(nBits / 8), this.bytes.length - this.byteOffset);
  }

  /** Reads 1..32 bits as an unsigned number. */
  bits(n: number): number {
    if (n < 1 || n > 32) throw new RangeError(`bit count ${n}`);
    this.need(n, `${n} bits`);
    if (this.log) this.log.push({ pos: this.pos, n, value: 0 });
    const value = this.msbFirst ? this.readMsb(n) : this.readLsb(n);
    if (this.log) this.log[this.log.length - 1].value = value;
    return value;
  }
  private readMsb(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const bit = (this.bytes[this.pos >>> 3] >>> (7 - (this.pos & 7))) & 1;
      value = value * 2 + bit;
      this.pos++;
    }
    return value;
  }
  private readLsb(n: number): number {
    let value = 0;
    let got = 0;
    while (got < n) {
      const byte = this.bytes[this.pos >>> 3];
      const shift = this.pos & 7;
      const take = Math.min(8 - shift, n - got);
      const chunk = (byte >>> shift) & ((1 << take) - 1);
      value += chunk * 2 ** got; // multiplication keeps values above 2^31 positive
      got += take;
      this.pos += take;
    }
    return value;
  }
  bool(): boolean {
    return this.bits(1) === 1;
  }
  /** Two's-complement signed value of `n` bits. */
  signedBits(n: number): number {
    const v = this.bits(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }
  u8(): number {
    return this.bits(8);
  }
  i8(): number {
    return this.signedBits(8);
  }
  u16(): number {
    return this.bits(16);
  }
  i16(): number {
    return this.signedBits(16);
  }
  u32(): number {
    return this.bits(32);
  }
  i32(): number {
    return this.signedBits(32);
  }
  f32(): number {
    const b = new Uint8Array(4);
    for (let i = 0; i < 4; i++) b[i] = this.u8();
    return new DataView(b.buffer).getFloat32(0, true);
  }
  bytesCopy(n: number): Uint8Array {
    const out = new Uint8Array(n);
    if ((this.pos & 7) === 0 && !this.log && !this.msbFirst) {
      this.need(n * 8, `${n} bytes`);
      out.set(this.bytes.subarray(this.pos >>> 3, (this.pos >>> 3) + n));
      this.pos += n * 8;
    } else for (let i = 0; i < n; i++) out[i] = this.u8();
    return out;
  }
  /** Null-terminated string (latin1). */
  string(): string {
    const chars: number[] = [];
    for (let c = this.u8(); c !== 0; c = this.u8()) chars.push(c);
    return latin1(Uint8Array.from(chars));
  }
  /** Null-padded fixed-size string field. */
  fixedString(size: number): string {
    const field = this.bytesCopy(size);
    const end = field.indexOf(0);
    return latin1(end < 0 ? field : field.subarray(0, end));
  }
  skipBits(n: number): void {
    this.need(n, `skip ${n} bits`);
    if (this.log) {
      for (let left = n; left > 0; left -= 32) this.bits(Math.min(32, left));
      return;
    }
    this.pos += n;
  }
  /** Reads and discards bits without logging them (fields that the target protocol doesn't have). */
  dropBits(n: number): void {
    this.need(n, `skip ${n} bits`);
    this.pos += n;
  }
  skipBytes(n: number): void {
    this.skipBits(n * 8);
  }
  /** Moves to the start of the next byte (no-op if already aligned). */
  alignToByte(): void {
    this.pos = (this.pos + 7) & ~7;
  }
  seekBit(bit: number): void {
    this.pos = bit;
    if (this.log) while (this.log.length && this.log[this.log.length - 1].pos >= bit) this.log.pop();
  }
}

/** Writes logged reads again in LSB-first order (protocol 43 → 44+ transcoding), padded to a whole byte. */
export function replayBits(w: BitWriter, log: readonly BitRead[]): void {
  for (const r of log) w.bits(r.value, r.n);
  w.alignToByte();
}

export class BitWriter {
  private buf = new Uint8Array(64);
  private pos = 0; // in bits

  get bitLength(): number {
    return this.pos;
  }

  private ensure(extraBits: number): void {
    const needBytes = (this.pos + extraBits + 7) >>> 3;
    if (needBytes <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < needBytes) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
  }

  /** Writes the low `n` (1..32) bits of `value`. */
  bits(value: number, n: number): void {
    if (n < 1 || n > 32) throw new RangeError(`bit count ${n}`);
    this.ensure(n);
    let v = value < 0 ? value + 2 ** 32 : value;
    let left = n;
    while (left > 0) {
      const shift = this.pos & 7;
      const take = Math.min(8 - shift, left);
      const chunk = v % 2 ** take;
      this.buf[this.pos >>> 3] |= chunk << shift;
      v = Math.floor(v / 2 ** take);
      left -= take;
      this.pos += take;
    }
  }
  bool(b: boolean): void {
    this.bits(b ? 1 : 0, 1);
  }
  u8(v: number): void {
    this.bits(v & 0xff, 8);
  }
  u16(v: number): void {
    this.bits(v & 0xffff, 16);
  }
  u32(v: number): void {
    this.bits(v >>> 0, 32);
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.u8(x);
  }
  string(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    this.u8(0);
  }
  fixedString(s: string, size: number): void {
    for (let i = 0; i < size; i++) this.u8(i < s.length && i < size - 1 ? s.charCodeAt(i) : 0);
  }
  /** Pads with zero bits to the next byte boundary. */
  alignToByte(): void {
    this.pos = (this.pos + 7) & ~7;
    this.ensure(0);
  }
  /** The written bytes (padded to whole bytes). */
  finish(): Uint8Array {
    return this.buf.slice(0, (this.pos + 7) >>> 3);
  }
}
