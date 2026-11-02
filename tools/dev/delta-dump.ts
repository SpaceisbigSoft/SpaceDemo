// Prints the delta descriptions (svc_deltadescription) of a demo as a TypeScript table (plan F4: the 1999 converter
// needs protocol 48's field tables, which 1999 demos don't carry). Usage: tsx tools/dev/delta-dump.ts <protocol-48 demo>
import { readFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { BitReader } from '../../engine/src/binary/bits.js';
import { DESCRIPTION_DESCRIPTOR } from '../../engine/src/protocol/delta.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';
import { Svc } from '../../engine/src/protocol/ids.js';

const demo = readDemo(readFileSync(process.argv[2]));
const s = createState(demo.header.networkProtocol, demo.header.gameDir);
const D = DESCRIPTION_DESCRIPTOR;
const out: string[] = [];
for (const f of demo.sections[0].frames) {
  if (f.type !== FrameType.NetMessagesLoading && f.type !== FrameType.NetMessages) continue;
  for (const m of decodeMessages(f.messages, s)) {
    if (m.id !== Svc.DeltaDescription) continue;
    const r = new BitReader(f.messages, m.start! + 1);
    const name = r.string();
    const count = r.bits(16);
    const rows: string[] = [];
    for (let i = 0; i < count; i++) {
      const rec = D.decode(r);
      const v = (k: string) => D.getInteger(rec, k) ?? 0;
      const fl = (k: string) => D.getFloat(rec, k) ?? 0;
      rows.push(`  ['${D.getText(rec, 'name')}', ${v('flags') >>> 0}, ${v('offset')}, ${v('size')}, ${v('nBits')}, ${fl('divisor')}, ${fl('preMultiplier')}],`);
    }
    out.push(`  ${name}: [\n${rows.join('\n')}\n  ],`);
  }
}
console.log(`export const DELTA48: Record<string, DeltaRow[]> = {\n${out.join('\n')}\n};`);
