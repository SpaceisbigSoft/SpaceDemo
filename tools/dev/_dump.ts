import { readFileSync, writeFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
const m = extractMatch(readDemo(new Uint8Array(readFileSync(process.argv[2]))), { tracks: true, samplesPerSecond: 10 });
const pts: number[][] = []; for (const tr of m.tracks ?? []) for (const p of tr.seen) if (p.alive) pts.push([p.x, p.y, p.z, p.time, tr.player]);
writeFileSync(process.argv[3], JSON.stringify(pts));
