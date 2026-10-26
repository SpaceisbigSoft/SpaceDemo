// Repair a damaged demo (plan 2.6): a recording cut off by a crash or a closed game has no directory
// (directory offset 0) and often a half-written last frame. The frames are recovered by scanning, the
// sections get end markers, and a new directory is written. The original file is never changed.
//   npm run repair -- <input.dem> <output.dem>
import { readFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { writeDemo } from '../engine/src/container/write.js';
import { writeNewFile } from '../engine/src/fix/safe-output.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.log('Usage: npm run repair -- <input.dem> <output.dem>   (output must be a different file)');
  process.exit(1);
}
const demo = readDemo(new Uint8Array(readFileSync(input)));
if (!demo.recovered && demo.problems.length === 0) {
  console.log('This demo is healthy; nothing to repair.');
  process.exit(0);
}
console.log('Problems found:\n  ' + demo.problems.join('\n  '));
const fixed = writeDemo(demo, { rebuildDirectory: true });
writeNewFile([input], output, fixed);
const again = readDemo(fixed);
const secs = again.sections.map((s) => `${s.entry?.description} ${s.entry?.trackTime.toFixed(1)} s, ${s.frames.length} frames`).join('; ');
console.log(`Repaired copy written: ${output}\n  ${secs}\n  ${again.problems.length ? 'Still has problems: ' + again.problems.join('; ') : 'Reads cleanly.'}`);
