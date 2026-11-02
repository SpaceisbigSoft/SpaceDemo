// Delta compression: servers describe structures (entity state, client data, events...) with
// svc_deltadescription, then send only the fields that changed. See docs/FORMAT.md.
import type { BitReader, BitWriter } from '../binary/bits.js';

const enum Flag {
  Byte = 1 << 0,
  Short = 1 << 1,
  Float = 1 << 2,
  Integer = 1 << 3,
  Angle = 1 << 4,
  TimeWindow8 = 1 << 5,
  TimeWindowBig = 1 << 6,
  String = 1 << 7,
}
const SIGNED = 0x80000000;

export type FieldKind = 'integer' | 'float' | 'angle' | 'string';

export interface DeltaField {
  name: string;
  bits: number;
  divisor: number;
  kind: FieldKind;
  signed: boolean;
}

/** A field value exactly as encoded: sign + magnitude bits for numbers, or text. */
export type RawValue = { readonly negative: boolean; readonly magnitude: number } | { readonly text: string };

/** One decoded delta: which fields were sent (`mask`) and their raw values (indexed like the descriptor's fields). */
export interface DeltaRecord {
  readonly mask: Uint8Array;
  readonly values: ReadonlyArray<RawValue | undefined>;
}

function kindOf(flags: number): FieldKind {
  if (flags & Flag.String) return 'string';
  if (flags & Flag.Angle) return 'angle';
  if (flags & (Flag.Float | Flag.TimeWindow8 | Flag.TimeWindowBig)) return 'float';
  if (flags & (Flag.Byte | Flag.Short | Flag.Integer)) return 'integer';
  throw new Error(`Unknown delta field type (flags ${flags >>> 0})`);
}

export class DeltaDescriptor {
  private readonly byName: Map<string, number>;

  constructor(readonly name: string, readonly fields: readonly DeltaField[]) {
    this.byName = new Map(fields.map((f, i) => [f.name, i]));
  }

  static field(name: string, bits: number, divisor: number, flags: number): DeltaField {
    return { name, bits, divisor, kind: kindOf(flags), signed: (flags & SIGNED) !== 0 && !(flags & (Flag.Angle | Flag.String)) };
  }

  decode(r: BitReader): DeltaRecord {
    const maskBytes = r.bits(3);
    const mask = new Uint8Array(maskBytes);
    for (let i = 0; i < maskBytes; i++) mask[i] = r.u8();
    const values: (RawValue | undefined)[] = [];
    const count = Math.min(this.fields.length, maskBytes * 8);
    for (let i = 0; i < count; i++) {
      if (!(mask[i >> 3] & (1 << (i & 7)))) continue;
      const f = this.fields[i];
      if (f.kind === 'string') values[i] = { text: r.string() };
      else if (f.signed) {
        const negative = r.bool();
        values[i] = { negative, magnitude: r.bits(f.bits - 1) };
      } else values[i] = { negative: false, magnitude: r.bits(f.bits) };
    }
    return { mask, values };
  }

  encode(w: BitWriter, d: DeltaRecord): void {
    w.bits(d.mask.length, 3);
    for (const m of d.mask) w.u8(m);
    const count = Math.min(this.fields.length, d.mask.length * 8);
    for (let i = 0; i < count; i++) {
      if (!(d.mask[i >> 3] & (1 << (i & 7)))) continue;
      const f = this.fields[i];
      const v = d.values[i];
      if (!v) throw new Error(`Delta "${this.name}": field ${f.name} is flagged but has no value`);
      if ('text' in v) w.string(v.text);
      else if (f.signed) {
        w.bool(v.negative);
        w.bits(v.magnitude, f.bits - 1);
      } else w.bits(v.magnitude, f.bits);
    }
  }

  /** Whole-number value of an integer field (magnitude / divisor), or undefined if not sent. */
  getInteger(d: DeltaRecord, name: string): number | undefined {
    const i = this.byName.get(name);
    if (i === undefined) return undefined;
    const v = d.values[i];
    if (!v || 'text' in v) return undefined;
    const n = Math.trunc(v.magnitude / Math.trunc(this.fields[i].divisor || 1));
    return v.negative ? -n : n;
  }

  /** Returns a copy of the record with an integer field changed (only if the field was sent). */
  withInteger(d: DeltaRecord, name: string, value: number): DeltaRecord {
    const i = this.byName.get(name);
    if (i === undefined || !d.values[i]) return d;
    const values = d.values.slice();
    values[i] = { negative: value < 0, magnitude: Math.abs(value) * Math.trunc(this.fields[i].divisor || 1) };
    return { mask: d.mask, values };
  }

  /** Returns a copy of the record with a numeric field set to 0 (only if the field was sent). */
  withZero(d: DeltaRecord, name: string): DeltaRecord {
    const i = this.byName.get(name);
    const v = i === undefined ? undefined : d.values[i];
    if (!v || 'text' in v || v.magnitude === 0) return d;
    const values = d.values.slice();
    values[i!] = { negative: false, magnitude: 0 };
    return { mask: d.mask, values };
  }

  getText(d: DeltaRecord, name: string): string | undefined {
    const i = this.byName.get(name);
    const v = i === undefined ? undefined : d.values[i];
    return v && 'text' in v ? v.text : undefined;
  }

  getFloat(d: DeltaRecord, name: string): number | undefined {
    const i = this.byName.get(name);
    const v = i === undefined ? undefined : d.values[i];
    if (!v || 'text' in v) return undefined;
    const x = v.magnitude / this.fields[i!].divisor;
    return v.negative ? -x : x;
  }
}

/** The fixed descriptor used to decode svc_deltadescription itself. */
export const DESCRIPTION_DESCRIPTOR = new DeltaDescriptor('delta_description_t', [
  DeltaDescriptor.field('flags', 32, 1, Flag.Integer),
  DeltaDescriptor.field('name', 8, 1, Flag.String),
  DeltaDescriptor.field('offset', 16, 1, Flag.Integer),
  DeltaDescriptor.field('size', 8, 1, Flag.Integer),
  DeltaDescriptor.field('nBits', 8, 1, Flag.Integer),
  DeltaDescriptor.field('divisor', 32, 4000, Flag.Float),
  DeltaDescriptor.field('preMultiplier', 32, 4000, Flag.Float),
]);

/** Builds a descriptor from the records of an svc_deltadescription message. */
export function descriptorFromRecords(name: string, records: DeltaRecord[]): DeltaDescriptor {
  const D = DESCRIPTION_DESCRIPTOR;
  const fields = records.map((rec) =>
    DeltaDescriptor.field(D.getText(rec, 'name') ?? '', D.getInteger(rec, 'nBits') ?? 0, D.getFloat(rec, 'divisor') ?? 1, (D.getInteger(rec, 'flags') ?? 0) >>> 0),
  );
  return new DeltaDescriptor(name, fields);
}
