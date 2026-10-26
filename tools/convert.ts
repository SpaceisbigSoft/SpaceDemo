// Development tool: upgrade an old CS demo to protocol 48.
//   npm run convert -- <input.dem> <output.dem> [--missing <file with one missing resource path per line>]
import { readFileSync } from 'node:fs';
import { readDemo } from '../engine/src/container/read.js';
import { writeDemo } from '../engine/src/container/write.js';
import { upgradeTo48 } from '../engine/src/transforms/upgrade-to-48.js';
import { writeNewFile } from '../engine/src/fix/safe-output.js';

const args = process.argv.slice(2);
const mi = args.indexOf('--missing');
let missing: Set<string> | undefined;
if (mi >= 0) {
  missing = new Set(readFileSync(args[mi + 1], 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
  args.splice(mi, 2);
}
const [input, output] = args;
if (!input || !output) {
  console.log('Usage: npm run convert -- <input.dem> <output.dem> [--missing <list.txt>]');
  process.exit(1);
}
const demo = readDemo(new Uint8Array(readFileSync(input)));
if (demo.problems.length) console.log('Problems found while reading:\n  ' + demo.problems.join('\n  '));
const { demo: upgraded, report } = upgradeTo48(demo, { isResourceMissing: missing && ((n) => missing!.has(n.toLowerCase())) });
writeNewFile([input], output, writeDemo(upgraded, { rebuildDirectory: true }));
console.log(`Converted protocol ${report.sourceProtocol} -> 48: ${output}`);
for (const [rule, n] of Object.entries(report.applied)) console.log(`  ${rule}: ${n}`);
for (const w of report.warnings) console.log(`  note: ${w}`);
