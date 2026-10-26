import { OutOfDataError } from './errors.js';

/** Sequential little-endian reader over a byte array. Never copies unless asked. */
export class ByteReader {
  private readonly view: DataView;
  offset: number;

  constructor(readonly bytes: Uint8Array, offset = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(n: number, what: string): void {
    if (n < 0 || this.offset + n > this.bytes.length) throw new OutOfDataError(what, this.offset, n, this.remaining);
  }

  u8(): number {
    this.need(1, 'u8');
    return this.view.getUint8(this.offset++);
  }
  u32(): number {
    this.need(4, 'u32');
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32(): number {
    this.need(4, 'i32');
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32(): number {
    this.need(4, 'f32');
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  /** Returns a view (no copy) of the next `n` bytes. */
  bytesView(n: number, what = 'bytes'): Uint8Array {
    this.need(n, what);
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  /** Fixed-size, null-padded text field. */
  fixedString(size: number): string {
    const field = this.bytesView(size, 'text field');
    const end = field.indexOf(0);
    return latin1(end < 0 ? field : field.subarray(0, end));
  }
  skip(n: number): void {
    this.need(n, 'skip');
    this.offset += n;
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
