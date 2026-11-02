// Converts a 1999 demo (format 4, protocol 38-40) to protocol 48 and checks the result reads back (plan F4).
// Usage: tsx tools/dev/convert-1999.ts <in.dem> <out.dem> [--game <Half-Life folder>]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { convert1999 } from '../../engine/src/legacy/convert-1999.js';
import { writeDemo } from '../../engine/src/container/write.js';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';
import { gameResourceCheck } from '../../engine/src/fix/fix.js';

const [inp, out] = process.argv.slice(2);
const gi = process.argv.indexOf('--game');
const game = gi > 0 ? process.argv[gi + 1] : undefined;
const { demo, report } = convert1999(readFileSync(inp), { isResourceMissing: game ? gameResourceCheck(game) : undefined });
const bytes = writeDemo(demo, { rebuildDirectory: true });
if (existsSync(out)) throw new Error('output exists');
writeFileSync(out, bytes);
console.log('applied', report.applied);
console.log('warnings', report.warnings.slice(0, 10), report.warnings.length);
// Read back with the protocol-48 reader.
const back = readDemo(bytes);
const s = createState(48, back.header.gameDir);
const counts: Record<string, number> = {};
let frames = 0;
for (const sec of back.sections) for (const f of sec.frames) {
  if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
  frames++;
  for (const m of decodeMessages(f.messages, s)) counts[m.name] = (counts[m.name] ?? 0) + 1;
}
console.log('read back OK:', back.problems, 'net frames', frames, counts);
