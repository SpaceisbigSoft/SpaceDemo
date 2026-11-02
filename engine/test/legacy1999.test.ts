// F4 1999 demos (format 4, protocol 38-40): the MSB-first reader, protocol 48's tables and encoders checked by
// reading their output back with the protocol-48 decoder (made-up data), and, when CDF_1999_DEMO points at an Old CS
// Lab recording (b61_test1.dem), a full conversion that reads back cleanly.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LegacyReader, createState40, decodeMessages40 } from '../src/legacy/p40.js';
import { DELTA48, deltaRecord, descriptors48, encodeDeltaDescriptions48 } from '../src/legacy/delta48.js';
import { convert1999, encodeMoveVars48, encodeSound48 } from '../src/legacy/convert-1999.js';
import { createState, decodeMessages } from '../src/protocol/messages.js';
import { encodeEntities } from '../src/protocol/encode.js';
import { writeDemo } from '../src/container/write.js';
import { readDemo } from '../src/container/read.js';
import { FrameType } from '../src/container/types.js';
import { Svc } from '../src/protocol/ids.js';
import { inspectDemo } from '../src/inspect.js';
import { readAnyDemo } from '../src/container/read-any.js';
import { extractMatch } from '../src/match/extract.js';

/** A protocol-48 state that has received our delta descriptions. */
function state48() {
  const s = createState(48, 'cstrike');
  const all = encodeDeltaDescriptions48();
  const bytes = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of all) { bytes.set(b, o); o += b.length; }
  expect(decodeMessages(bytes, s).map((m) => m.id)).toEqual(all.map(() => Svc.DeltaDescription));
  return s;
}

describe('F4 1999: MSB-first bit reader', () => {
  it('starts bits at the current byte and continues byte reads after the last byte touched', () => {
    const r = new LegacyReader(Uint8Array.of(0xa5, 0b1011_0000, 0x7f, 0x34, 0x12));
    expect(r.u8()).toBe(0xa5);
    r.startBits();
    expect(r.bits(1)).toBe(1);
    expect(r.bits(3)).toBe(0b011);
    expect(r.bits(6)).toBe(0b0000_01); // crosses into 0x7f
    expect(r.p).toBe(3); // two bytes started
    expect(r.u16()).toBe(0x1234);
  });
  it('reads sign-and-magnitude values', () => {
    const r = new LegacyReader(Uint8Array.of(0b1000_0101, 0));
    r.startBits();
    expect(r.sbits(8)).toBe(-5);
  });
});

describe('F4 1999: protocol 48 tables and encoders', () => {
  it('sends delta descriptions the protocol-48 reader turns back into the same fields', () => {
    const s = state48();
    for (const [name, rows] of Object.entries(DELTA48)) {
      const d = s.deltas.get(name)!;
      expect(d.fields.map((f) => [f.name, f.bits, f.divisor])).toEqual(rows.map(([n, , , , bits, div]) => [n, bits, div]));
    }
  });
  it('writes entities (players and others) the protocol-48 reader decodes to the same values', () => {
    const s = state48();
    s.maxClients = 2;
    const d48 = descriptors48();
    const player = { 'origin[0]': -895.40625, 'origin[1]': 3344.03125, 'origin[2]': 36.03125, 'angles[1]': 180, sequence: 33, gaitsequence: 3, modelindex: 162, framerate: 1 };
    const door = { 'origin[2]': -12.5, modelindex: 26, movetype: 7, solid: 4, skin: -1 };
    const bytes = encodeEntities({ kind: 'entities', isDelta: false, count: 2, entities: [
      { number: 1, numbering: { mode: 'next' }, remove: false, custom: false, descriptor: 'entity_state_player_t', record: deltaRecord(d48.get('entity_state_player_t')!, player) },
      { number: 60, numbering: { mode: 'relative', value: 59 }, remove: false, custom: false, descriptor: 'entity_state_t', record: deltaRecord(d48.get('entity_state_t')!, door) },
    ] }, d48);
    const [m] = decodeMessages(bytes, s);
    expect(m.body?.kind).toBe('entities');
    if (m.body?.kind !== 'entities') return;
    const [p, e] = m.body.entities;
    const pd = s.deltas.get('entity_state_player_t')!, ed = s.deltas.get('entity_state_t')!;
    expect([p.number, e.number]).toEqual([1, 60]);
    expect(pd.getFloat(p.record!, 'origin[0]')).toBeCloseTo(-895.40625, 5);
    expect(pd.getInteger(p.record!, 'gaitsequence')).toBe(3);
    expect(pd.getInteger(p.record!, 'modelindex')).toBe(162);
    expect(ed.getFloat(e.record!, 'origin[2]')).toBeCloseTo(-12.5, 5);
    expect(ed.getInteger(e.record!, 'skin')).toBe(-1);
    // Against a baseline only the changed fields are sent.
    const again = deltaRecord(d48.get('entity_state_t')!, { ...door, 'origin[2]': 0 }, door);
    expect(again.values.filter(Boolean)).toHaveLength(1);
  });
  it('writes sounds and movevars in protocol 48 layout', () => {
    const s = state48();
    const sound = encodeSound48({ flags: 1 | 8, volume: 200, channel: 2, entity: 1, index: 300, origin: [-895.5, 3344, 0], pitch: 98 });
    const mv = encodeMoveVars48([800, 75, 320, 500, 5, 10, 10, 4, 2, 1, 1, 1, 18, 2000, 8000, 0], 'desert');
    const out = decodeMessages(Uint8Array.from([...sound, ...mv]), s);
    expect(out.map((m) => m.id)).toEqual([Svc.Sound, Svc.NewMoveVars]);
    const b = out[0].body;
    expect(b?.kind).toBe('sound');
    if (b?.kind === 'sound') expect([b.entity, b.sound, b.channel, ...b.origin]).toEqual([1, 300, 2, -895.5, 3344, undefined]);
  });
});

describe('F4 1999: protocol 38 svc_playerinfo (HL 1.0.1.0)', () => {
  // The first svc_playerinfo of the Old CS Lab survey demo HL1010.dem (21 bytes after the id; there svc_packetentities
  // follows), then svc_print, so the test sees whether the reader stopped at the right byte.
  const pi = [0x2b, 0x8f, 0x06, 0x00, 0x12, 0xb0, 0x02, 0x00, 0x16, 0x6c, 0x00, 0x00, 0x50, 0x00, 0x01,
    0xb0, 0x29, 0x81, 0x60, 0x86, 0x68, 0x08];
  const bytes = Uint8Array.from([...pi, 0x08, 0x6f, 0x6b, 0x00]); // svc_print "ok"
  it('reads origin as 16 bits x 1/8 and velocity as 9 bits x 4, ending where the next message starts', () => {
    const msgs = decodeMessages40(bytes, createState40(38));
    expect(msgs.map((m) => m.name)).toEqual(['PlayerInfo', 'Print']);
    expect(msgs[0].end).toBe(pi.length);
    const p = (msgs[0].body as unknown as { player: { origin: number[]; slot: number } }).player;
    expect(p.slot).toBe(0);
    for (const v of p.origin) expect(Number.isInteger(v * 8)).toBe(true);
  });
  it('the same bytes read as protocol 40 do not end there (the layouts really differ)', () => {
    let ok = true;
    try { ok = decodeMessages40(bytes, createState40(40))[0].end !== pi.length; } catch { ok = true; }
    expect(ok).toBe(true);
  });
});

const demo = process.env.CDF_1999_DEMO;
describe.skipIf(!demo || !existsSync(demo))('F4 1999: real demo (CDF_1999_DEMO)', () => {
  it('converts every frame and the result reads back as protocol 48', () => {
    const { demo: out, report } = convert1999(readFileSync(demo!));
    expect(report.warnings.filter((w) => w.includes('could not be read'))).toEqual([]);
    const back = readDemo(writeDemo(out, { rebuildDirectory: true }));
    expect(back.header.networkProtocol).toBe(48);
    const s = createState(48, 'cstrike');
    let entities = 0;
    for (const sec of back.sections) for (const f of sec.frames) {
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      for (const m of decodeMessages(f.messages, s)) if (m.body?.kind === 'entities') entities++;
    }
    expect(entities).toBeGreaterThan(100);
  }, 120_000);
  it('is inspected and analysed through the converter (library and details), naming its own protocol', () => {
    const bytes = readFileSync(demo!);
    const r = inspectDemo(bytes);
    expect([r.networkProtocol, r.demoProtocol, r.gameDir, r.mapName]).toEqual([40, 4, 'cstrike', 'de_dust']);
    expect(r.problems).toEqual([]);
    expect(r.seconds).toBeGreaterThan(60);
    expect(r.players.filter((p) => p.name).length).toBeGreaterThan(0);
    const m = extractMatch(readAnyDemo(bytes).demo, { tracks: true });
    expect(m.players.length).toBeGreaterThan(0);
  }, 120_000);
});
