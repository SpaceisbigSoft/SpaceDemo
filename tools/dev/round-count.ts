// Prints rounds and winners per demo (regression check for round detection). Usage: tsx tools/dev/round-count.ts <demo>...
import { readFileSync } from 'node:fs';
import { readAnyDemo } from '../../engine/src/container/read-any.js';
import { extractMatch } from '../../engine/src/match/extract.js';
for (const f of process.argv.slice(2)) {
  try {
    const m = extractMatch(readAnyDemo(readFileSync(f)).demo);
    console.log(f.split('/').pop(), m.rounds.length, m.rounds.map((r) => `${r.winner}:${r.reason}`).join(','));
  } catch (e) {
    console.log(f.split('/').pop(), 'ERROR', (e as Error).message);
  }
}
