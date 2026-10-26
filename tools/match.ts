// Match data of demos (plan 2.12): summary per demo plus a check against the server's own scores.
//   npm run match -- <demo.dem | folder>... [--json <out folder>]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readDemo } from '../engine/src/container/read.js';
import { checkMatch, extractMatch } from '../engine/src/match/extract.js';

const args = process.argv.slice(2);
const ji = args.indexOf('--json');
const jsonDir = ji >= 0 ? args.splice(ji, 2)[1] : undefined;
if (jsonDir) mkdirSync(jsonDir, { recursive: true });
const files: string[] = [];
const collect = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) collect(join(p, e));
  else if (extname(p).toLowerCase() === '.dem') files.push(p);
};
for (const a of args) collect(a);
if (!files.length) {
  console.log('Usage: npm run match -- <demo.dem | folder>... [--json <out folder>]');
  process.exit(1);
}
for (const path of files) {
  const m = extractMatch(readDemo(new Uint8Array(readFileSync(path))));
  const c = checkMatch(m);
  const hs = m.kills.filter((k) => k.headshot).length;
  const shots = m.players.reduce((n, p) => n + Object.values(p.shots).reduce((a, b) => a + b, 0), 0);
  console.log(`${basename(path)}: ${m.recording} ${m.map}, ${m.rounds.length} rounds (T ${c.roundsWon.T} / CT ${c.roundsWon.CT}; server ${c.serverScore ? `${c.serverScore.T}-${c.serverScore.CT}` : 'none'}), ${m.kills.length} kills (${hs} HS), ${m.deaths.length} deaths, ${m.chat.length} chat, ${m.radio.length} radio, ${m.bomb.filter((b) => b.kind === 'planted').length} plants, ${shots} shots, ${m.voice.length} voice bursts, restarts ${m.restarts} | check: frags ${c.fragsMatch ? 'OK' : 'DIFF ' + JSON.stringify(c.fragMismatches)}, rounds ${c.roundsMatch ? 'OK' : 'DIFF'}`);
  if (jsonDir) writeFileSync(join(jsonDir, basename(path).replace(/\.dem$/i, '.json')), JSON.stringify(m, null, 1));
}
