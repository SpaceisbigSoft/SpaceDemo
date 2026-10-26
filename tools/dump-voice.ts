// Development tool: dump every svc_voicedata message of a demo, in order, as [slot u8][time f64][length u16][bytes].
//   npx tsx tools/dump-voice.ts <demo.dem> <output.voice>
import { readFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { FrameType } from '../engine/src/container/types.js';
import { createState, decodeMessages } from '../engine/src/protocol/messages.js';
import { writeNewFile } from '../engine/src/fix/safe-output.js';
const [input, output] = process.argv.slice(2);
const demo = readDemo(new Uint8Array(readFileSync(input)));
const state = createState(demo.header.networkProtocol, demo.header.gameDir);
const parts: Buffer[] = [];
const sizes = new Map<number, number>();
for (const s of demo.sections) for (const f of s.frames) {
  if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
  for (const m of decodeMessages(f.messages, state)) {
    if (m.body?.kind === 'voiceInit') console.log('voiceInit', m.body);
    if (m.body?.kind !== 'voiceData') continue;
    const h = Buffer.alloc(11);
    h.writeUInt8(m.body.slot, 0); h.writeDoubleLE(f.time, 1); h.writeUInt16LE(m.body.data.length, 9);
    parts.push(h, Buffer.from(m.body.data));
    sizes.set(m.body.data.length, (sizes.get(m.body.data.length) ?? 0) + 1);
  }
}
writeNewFile([input], output, Buffer.concat(parts));
console.log('sizes', [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 12));
