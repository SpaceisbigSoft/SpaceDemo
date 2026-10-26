// Bit-level reader for GoldSrc network messages.
// Ported from compLexity Demo Player (BitBuffer.cs), GPL v3.

export class BitBufferOutOfRange extends Error {
  constructor() {
    super('Read past end of message buffer');
  }
}

export class BitBuffer {
  /** Little endian is the normal GoldSrc bit order; big endian is used by protocol <= 43 in some messages. */
  bigEndian = false;
  private bit = 0;

  constructor(readonly data: Uint8Array) {}

  get length(): number {
    return this.data.length;
  }
  get currentBit(): number {
    return this.bit;
  }
  get currentByte(): number {
    return this.bit >> 3;
  }
  get bytesLeft(): number {
    return this.data.length - this.currentByte;
  }

  seekBits(count: number): void {
    this.bit += count;
    if (this.bit < 0 || this.bit > this.data.length * 8) throw new BitBufferOutOfRange();
  }
  seekBytes(count: number): void {
    this.seekBits(count * 8);
  }
  skipRemainingBits(): void {
    const off = this.bit % 8;
    if (off !== 0) this.seekBits(8 - off);
  }

  readUnsignedBits(nBits: number): number {
    if (nBits <= 0 || nBits > 32) throw new Error(`Bad bit count ${nBits}`);
    if (this.bit + nBits > this.data.length * 8) throw new BitBufferOutOfRange();
    const startByte = this.bit >> 3;
    const bitOffset = this.bit & 7;
    const nBytes = Math.ceil((bitOffset + nBits) / 8);
    let value = 0n;
    if (!this.bigEndian) {
      for (let i = 0; i < nBytes; i++) value |= BigInt(this.data[startByte + i]) << BigInt(i * 8);
      value >>= BigInt(bitOffset);
    } else {
      for (let i = 0; i < nBytes; i++) value |= BigInt(this.data[startByte + (nBytes - 1) - i]) << BigInt(i * 8);
      value >>= BigInt(nBytes * 8 - bitOffset - nBits);
    }
    value &= (1n << BigInt(nBits)) - 1n;
    this.bit += nBits;
    return Number(value);
  }

  /** Two's-complement signed read (low n-1 bits, then sign bit), as COL's ReadBits. */
  readBits(nBits: number): number {
    let result = this.readUnsignedBits(nBits - 1);
    if (this.readBoolean()) result = -((2 ** (nBits - 1)) - result);
    return result;
  }

  readBoolean(): boolean {
    if (this.bit + 1 > this.data.length * 8) throw new BitBufferOutOfRange();
    const byte = this.data[this.bit >> 3];
    const mask = this.bigEndian ? 128 >> (this.bit % 8) : 1 << (this.bit % 8);
    this.bit++;
    return (byte & mask) !== 0;
  }

  readByte(): number {
    return this.readUnsignedBits(8);
  }
  readSByte(): number {
    return this.readBits(8);
  }
  readBytes(n: number): Uint8Array {
    if (this.bit % 8 === 0) {
      const start = this.bit >> 3;
      if (start + n > this.data.length) throw new BitBufferOutOfRange();
      this.bit += n * 8;
      return this.data.slice(start, start + n);
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readByte();
    return out;
  }
  readUInt16(): number {
    return this.readUnsignedBits(16);
  }
  readInt16(): number {
    return this.readBits(16);
  }
  readUInt32(): number {
    return this.readUnsignedBits(32);
  }
  readInt32(): number {
    return this.readBits(32);
  }
  readFloat(): number {
    return new DataView(this.readBytes(4).buffer).getFloat32(0, true);
  }

  /** Null-terminated string. Bytes are decoded as latin1 (old player names are not UTF-8). */
  readString(): string {
    const bytes: number[] = [];
    for (;;) {
      const b = this.readByte();
      if (b === 0) break;
      bytes.push(b);
    }
    return Buffer.from(bytes).toString('latin1');
  }
  /** Fixed-length string field: reads a null-terminated string, then skips to the end of the field. */
  readFixedString(length: number): string {
    const start = this.bit;
    const s = this.readString();
    this.seekBits(length * 8 - (this.bit - start));
    return s;
  }

  readCoord(): number {
    const intFlag = this.readBoolean();
    const fracFlag = this.readBoolean();
    if (!intFlag && !fracFlag) return 0;
    const sign = this.readBoolean();
    const i = intFlag ? this.readUnsignedBits(12) : 0;
    const f = fracFlag ? this.readUnsignedBits(3) : 0;
    const v = i + f / 32;
    return sign ? -v : v;
  }
  readVectorCoord(): [number, number, number] {
    const x = this.readBoolean();
    const y = this.readBoolean();
    const z = this.readBoolean();
    return [x ? this.readCoord() : 0, y ? this.readCoord() : 0, z ? this.readCoord() : 0];
  }
}
