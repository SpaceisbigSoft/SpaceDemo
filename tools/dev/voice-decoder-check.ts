// Plan 2.8 check: the Windows voice helper (under Wine here) and the emulator decode a demo's old voice identically.
//   npx tsx tools/dev/voice-decoder-check.ts <old demo.dem> <mssvoice.asi> [--first N]
import { readFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { upgradeTo48 } from '../../engine/src/transforms/upgrade-to-48.js';
import { oldVoicePackets } from '../../engine/src/voice/restore.js';
import { emulatorDecoder, helperDecoder } from '../../engine/src/voice/decoders.js';

const args = process.argv.slice(2);
const fi = args.indexOf('--first');
const first = fi >= 0 ? Number(args.splice(fi, 2)[1]) : Infinity;
const [demoPath, asi] = args;
const demo = upgradeTo48(readDemo(new Uint8Array(readFileSync(demoPath)))).demo;
const packets = oldVoicePackets(demo).slice(0, first);
const t0 = Date.now();
const a = helperDecoder('helpers/voice-helper/cdf-voice-helper.exe', asi, { wine: 'wine' }).decodeAll(packets);
const t1 = Date.now();
const b = emulatorDecoder(asi).decodeAll(packets);
const t2 = Date.now();
let samples = 0, diff = 0, maxd = 0;
for (let i = 0; i < packets.length; i++) {
  if (a[i].length !== b[i].length) { console.log(`packet ${i}: length ${a[i].length} vs ${b[i].length}`); diff++; continue; }
  for (let k = 0; k < a[i].length; k++) { samples++; const d = Math.abs(a[i][k] - b[i][k]); if (d) { diff++; maxd = Math.max(maxd, d); } }
}
console.log(`${packets.length} packets, ${samples} samples: helper ${(t1 - t0) / 1000} s, emulator ${(t2 - t1) / 1000} s; differing samples ${diff} (max ${maxd})`);
