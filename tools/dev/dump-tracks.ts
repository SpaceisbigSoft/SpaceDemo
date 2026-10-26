// Dumps match data with position tracks (20 samples/s) per demo as JSON, for tools/dev/walk-check.ts and walk-preview.ts.
//   npx tsx tools/dev/dump-tracks.ts <demos folder> <out folder>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
const files: string[] = [];
const walk = (p: string) => statSync(p).isDirectory() ? readdirSync(p).forEach((e) => walk(join(p, e))) : extname(p) === '.dem' && files.push(p);
walk(process.argv[2]);
for (const f of files) {
  const demo = readDemo(new Uint8Array(readFileSync(f)));
  const m = extractMatch(demo, { tracks: true, samplesPerSecond: 20 });
  const seen = (m.tracks ?? []).reduce((a, t) => a + t.seen.length, 0);
  writeFileSync(join(process.argv[3], basename(f, '.dem') + '.json'), JSON.stringify({ file: basename(f), map: m.map, checksum: demo.header.mapChecksum, recording: m.recording, players: m.players, rounds: m.rounds, deaths: m.deaths, kills: m.kills, bomb: m.bomb, tracks: m.tracks }));
  console.log(basename(f), m.map, m.recording, 'seen', seen);
}
