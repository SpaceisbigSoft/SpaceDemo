// Reader for game ("user") message payloads: little-endian numbers, coords and zero-terminated strings.
// Reading past the end returns 0 / "" instead of throwing, because some servers send short messages.

export class PayloadReader {
  private o = 0;

  constructor(private readonly b: Uint8Array) {}

  get remaining(): number {
    return Math.max(0, this.b.length - this.o);
  }

  u8(): number {
    return this.o < this.b.length ? this.b[this.o++] : (this.o++, 0);
  }

  i8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }

  i16(): number {
    const v = this.u8() | (this.u8() << 8);
    return v > 32767 ? v - 65536 : v;
  }

  i32(): number {
    return this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24);
  }

  /** WRITE_COORD: signed 16-bit value in 1/8 units. */
  coord(): number {
    return this.i16() / 8;
  }

  /** Zero-terminated string (Latin-1). */
  str(): string {
    let s = '';
    while (this.o < this.b.length) {
      const c = this.b[this.o++];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}
