// Find Steam + CS 1.6 and play a fixed demo (plans 3.1, 3.2).
//   npm run play -- --find                         show what was found (nothing is started or written)
//   npm run play -- <fixed.dem> [--mode auto|viewdemo|playdemo] [--speed 2] [--name <name>]
//                  [--steam <Steam folder>] [--game <Half-Life folder>] [--keep] [--no-wait] [--dry-run]
//   npm run play -- --cleanup                      remove copies left in cdf_test (game must be closed)
// After starting the game it waits for the game to close and then removes the copy it made (plan 3.5); --keep keeps it (not listed for cleanup).
// The fixed demo is copied into <game>\cstrike\cdf_test\ (our own folder) unless it is already there; the original is never
// touched. Steam starts the game with -insecure (anti-cheat safety rule).
import { findGame } from '../engine/src/launch/steam.js';
import { isGameRunning, launch, planLaunch, type PlayMode } from '../engine/src/launch/launch.js';
import { cleanupCopies, waitForGameClose } from '../engine/src/launch/cleanup.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const steamDir = opt('--steam'), gameDir = opt('--game'), modeArg = opt('--mode'), speedArg = opt('--speed'), name = opt('--name');
const findOnly = flag('--find'), dryRun = flag('--dry-run'), cleanupOnly = flag('--cleanup'), keep = flag('--keep'), noWait = flag('--no-wait');
const [demo] = args;

if (!findOnly && !cleanupOnly && !demo) {
  console.log('Usage: npm run play -- --find | <fixed.dem> [--mode auto|viewdemo|playdemo] [--speed N] [--name <name>] [--steam <dir>] [--game <dir>] [--dry-run]');
  process.exit(1);
}

const found = findGame({ steamDir, gameDir });
console.log(`Steam:          ${found.steam ? `${found.steam.exe} (found via ${found.steam.source})` : 'not found'}`);
console.log(`Libraries:      ${found.libraries.join(' | ') || '-'}`);
if (found.game) {
  const m = found.game.manifest;
  console.log(`Counter-Strike: ${found.game.dir} (found via ${found.game.source})`);
  console.log(`                version ${found.game.patchVersion ?? '?'}${m?.buildId ? `, Steam build ${m.buildId}` : ''}${m?.betaKey ? `, branch ${m.betaKey}` : ''}`);
} else console.log('Counter-Strike: not found');
for (const n of found.notes) console.log(`  note: ${n}`);
for (const p of found.problems) console.log(`  PROBLEM: ${p}`);
if (findOnly) process.exit(found.steam && found.game ? 0 : 2);
const report = (r: { removed: string[]; changed: string[] }) => {
  for (const f of r.removed) console.log(`Removed copy: ${f}`);
  for (const f of r.changed) console.log(`Left alone (changed since it was copied): ${f}`);
  if (!r.removed.length && !r.changed.length) console.log('No copies to remove.');
};
if (cleanupOnly) {
  if (!found.game) process.exit(2);
  if (isGameRunning()) { console.log('Counter-Strike is still open; close it first.'); process.exit(2); }
  report(cleanupCopies(found.game.cstrikeDir));
  process.exit(0);
}
if (!found.steam || !found.game) process.exit(2);

const plan = planLaunch(demo, found.steam, found.game, {
  mode: (modeArg as PlayMode | 'auto' | undefined) ?? 'auto',
  speed: speedArg ? Number(speedArg) : 1,
  name,
});
console.log(`Demo:           ${plan.source}`);
console.log(`Maps:           ${plan.maps.join(' → ')}`);
console.log(`Game copy:      ${plan.target}${plan.copyNeeded ? ' (will be written)' : ' (already there)'}`);
console.log(`Command:        "${plan.steamExe}" ${plan.args.join(' ')}`);
for (const n of plan.notes) console.log(`  note: ${n}`);
for (const p of plan.problems) console.log(`  PROBLEM: ${p}`);
if (dryRun) process.exit(plan.problems.length ? 2 : 0);
const r = launch(plan, { keepCopy: keep });
console.log(r.message);
if (!r.started) process.exit(2);
if (keep || noWait) {
  console.log(keep ? 'Keeping the copy in cdf_test.' : 'Not waiting: the copy is removed the next time you play a demo (or with --cleanup).');
  process.exit(0);
}
console.log('Waiting for Counter-Strike to close...');
const end = await waitForGameClose(isGameRunning);
if (end === 'never-started') console.log('The game didn\'t start within 2 minutes; the copy is removed the next time you play a demo (or with --cleanup).');
else report(cleanupCopies(found.game.cstrikeDir));
