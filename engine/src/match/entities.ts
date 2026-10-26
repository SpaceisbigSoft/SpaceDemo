// Exact entity states over time (plan 2.13). svc_deltapacketentities is a delta against an OLDER frame, named by
// a sequence byte (in Set 1 usually 2-3 frames back), not against the previous frame. Like the game client, we keep
// the last 64 frames' states by incoming sequence number and build each new frame from the one it names.
// Entities not listed in a delta keep their state from that reference frame.
import type { DeltaDescriptor, DeltaRecord } from '../protocol/delta.js';
import type { BaselineBody, EntitiesBody, ProtocolState } from '../protocol/messages.js';

/** Decoded field values of one entity, by field name. */
export type EntityState = Record<string, number | string>;

const UPDATE_MASK = 63;

/** Converts a delta record into numbers (angles in degrees, floats divided by their divisor) on top of `base`. */
export function applyRecord(d: DeltaDescriptor, rec: DeltaRecord, base: EntityState): EntityState {
  const out: EntityState = { ...base };
  rec.values.forEach((v, i) => {
    if (!v) return;
    const f = d.fields[i];
    if ('text' in v) {
      out[f.name] = v.text;
      return;
    }
    let x: number;
    if (f.kind === 'angle') x = (v.magnitude * 360) / 2 ** f.bits;
    else if (f.kind === 'float') x = v.magnitude / (f.divisor || 1);
    else x = Math.trunc(v.magnitude / Math.trunc(f.divisor || 1));
    out[f.name] = v.negative ? -x : x;
  });
  return out;
}

export class EntityTracker {
  private readonly frames: (Map<number, EntityState> | undefined)[] = new Array(UPDATE_MASK + 1);
  private readonly baselines = new Map<number, EntityState>();
  /** States of the most recent frame. */
  current = new Map<number, EntityState>();

  constructor(private readonly s: ProtocolState) {}

  baseline(b: BaselineBody): void {
    for (const e of b.entities) {
      const d = this.s.deltas.get(e.descriptor);
      if (d) this.baselines.set(e.index, applyRecord(d, e.record, {}));
    }
  }

  /** Applies one packet-entities message received in the frame with this incoming sequence number. */
  packet(b: EntitiesBody, incomingSequence: number): Map<number, EntityState> {
    let next: Map<number, EntityState>;
    let reference: Map<number, EntityState> | undefined;
    if (b.isDelta) {
      reference = this.frames[b.deltaSequence! & UPDATE_MASK];
      // If the reference frame is unknown (start of recording), fall back to the latest frame.
      next = new Map(reference ?? this.current);
      reference ??= this.current;
    } else {
      next = new Map();
    }
    for (const e of b.entities) {
      if (e.remove) {
        next.delete(e.number);
        continue;
      }
      const d = this.s.deltas.get(e.descriptor);
      if (!d || !e.record) continue;
      const base = reference?.get(e.number) ?? this.baselines.get(e.number) ?? {};
      next.set(e.number, applyRecord(d, e.record, base));
    }
    this.frames[incomingSequence & UPDATE_MASK] = next;
    this.current = next;
    return next;
  }
}

/** Incoming sequence number of a network frame (first value of the 28-byte sequence info at the end of `info`). */
export function incomingSequence(info: Uint8Array): number {
  return new DataView(info.buffer, info.byteOffset + info.length - 28, 4).getInt32(0, true);
}
