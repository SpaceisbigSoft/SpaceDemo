// GoldSrc delta-compression descriptions and decoder.
// Ported from compLexity Demo Player (HalfLifeDelta.cs), GPL v3.
import type { BitBuffer } from './bitbuffer.js';

export const DeltaFlags = {
  Byte: 1 << 0,
  Short: 1 << 1,
  Float: 1 << 2,
  Integer: 1 << 3,
  Angle: 1 << 4,
  TimeWindow8: 1 << 5,
  TimeWindowBig: 1 << 6,
  String: 1 << 7,
  Signed: 0x80000000,
} as const;

export interface DeltaEntry {
  name: string;
  nBits: number;
  divisor: number;
  flags: number;
}

export type DeltaValues = Map<string, number | string>;

export class DeltaStructure {
  readonly entries: DeltaEntry[] = [];
  constructor(readonly name: string) {}

  addEntry(name: string, nBits: number, divisor: number, flags: number): void {
    this.entries.push({ name, nBits, divisor, flags });
  }

  /** Reads one delta. If `out` is given, decoded field values are stored in it. */
  read(bb: BitBuffer, out?: DeltaValues): void {
    const nMaskBytes = bb.readUnsignedBits(3);
    if (nMaskBytes === 0) return;
    const mask: number[] = [];
    for (let i = 0; i < nMaskBytes; i++) mask.push(bb.readByte());
    for (let i = 0; i < nMaskBytes; i++) {
      for (let j = 0; j < 8; j++) {
        const index = j + i * 8;
        if (index === this.entries.length) return;
        if ((mask[i] & (1 << j)) !== 0) {
          const e = this.entries[index];
          const v = parseEntry(bb, e);
          out?.set(e.name, v);
        }
      }
    }
  }
}

function parseEntry(bb: BitBuffer, e: DeltaEntry): number | string {
  const signed = (e.flags & DeltaFlags.Signed) !== 0;
  if (e.flags & (DeltaFlags.Byte | DeltaFlags.Short | DeltaFlags.Integer)) {
    if (signed) {
      const negative = bb.readBoolean();
      const v = Math.trunc(bb.readUnsignedBits(e.nBits - 1) / Math.trunc(e.divisor));
      return negative ? -v : v;
    }
    return Math.trunc(bb.readUnsignedBits(e.nBits) / Math.trunc(e.divisor));
  }
  if (e.flags & (DeltaFlags.Float | DeltaFlags.TimeWindow8 | DeltaFlags.TimeWindowBig)) {
    let bits = e.nBits;
    let negative = false;
    if (signed) {
      negative = bb.readBoolean();
      bits--;
    }
    return (bb.readUnsignedBits(bits) / e.divisor) * (negative ? -1 : 1);
  }
  if (e.flags & DeltaFlags.Angle) {
    return bb.readUnsignedBits(e.nBits) * (360 / 2 ** e.nBits);
  }
  if (e.flags & DeltaFlags.String) {
    return bb.readString();
  }
  throw new Error(`Unknown delta entry type ${e.flags} (${e.name})`);
}

/** The built-in structure used to decode svc_deltadescription messages. */
export function createDeltaDescriptionStructure(): DeltaStructure {
  const s = new DeltaStructure('delta_description_t');
  s.addEntry('flags', 32, 1, DeltaFlags.Integer);
  s.addEntry('name', 8, 1, DeltaFlags.String);
  s.addEntry('offset', 16, 1, DeltaFlags.Integer);
  s.addEntry('size', 8, 1, DeltaFlags.Integer);
  s.addEntry('nBits', 8, 1, DeltaFlags.Integer);
  s.addEntry('divisor', 32, 4000, DeltaFlags.Float);
  s.addEntry('preMultiplier', 32, 4000, DeltaFlags.Float);
  return s;
}
