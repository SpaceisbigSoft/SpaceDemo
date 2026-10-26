// Find Steam + CS 1.6 and play a fixed demo (plans 3.1, 3.2).
//   npm run play -- --find                         show what was found (nothing is started or written)
//   npm run play -- <fixed.dem> [--mode auto|viewdemo|playdemo] [--speed 2] [--name <name>]
//                  [--steam <Steam folder>] [--game <Half-Life folder>] [--no-keys] [--mute-slowmo] [--no-wait] [--dry-run]
//   npm run play -- --restore                      put your own keys back now (if a game closed while nobody watched)
// Playback keys (viewdemo): P pause/resume, J/L slower/faster, HOME normal speed, F6/F7 back/forward 30 s. When the game
// closes, the keys and voice volume in cstrike\config.cfg are put back as they were (owner's choice, 2026-10-26).
// The fixed demo is copied into <game>\cstrike\cdf_test\ (our own folder) unless it is already there; the original is never
// touched. Steam starts the game with -insecure (anti-cheat safety rule).
import { findGame } from '../engine/src/launch/steam.js';
import { isGameRunning, launch, planLaunch, waitAndRestore, type PlayMode } from '../engine/src/launch/launch.js';
import { restoreControls } from '../engine/src/launch/controls.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const steamDir = opt('--steam'), gameDir = opt('--game'), modeArg = opt('--mode'), speedArg = opt('--speed'), name = opt('--name');
const findOnly = flag('--find'), dryRun = flag('--dry-run'), restoreOnly = flag('--restore'), noKeys = flag('--no-keys'), muteSlowmo = flag('--mute-slowmo'), noWait = flag('--no-wait');
const [demo] = args;

if (!findOnly && !restoreOnly && !demo) {
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
if (restoreOnly) {
  if (!found.game) process.exit(2);
  if (isGameRunning()) { console.log('Counter-Strike is still open; close it first.'); process.exit(2); }
  console.log(restoreControls(found.game.cstrikeDir).message);
  process.exit(0);
}
if (!found.steam || !found.game) process.exit(2);

const plan = planLaunch(demo, found.steam, found.game, {
  mode: (modeArg as PlayMode | 'auto' | undefined) ?? 'auto',
  speed: speedArg ? Number(speedArg) : 1,
  name,
  controls: !noKeys,
  controlOptions: { muteVoiceInSlowMotion: muteSlowmo },
});
console.log(`Demo:           ${plan.source}`);
console.log(`Maps:           ${plan.maps.join(' → ')}`);
console.log(`Game copy:      ${plan.target}${plan.copyNeeded ? ' (will be written)' : ' (already there)'}`);
console.log(`Command:        "${plan.steamExe}" ${plan.args.join(' ')}`);
for (const n of plan.notes) console.log(`  note: ${n}`);
for (const p of plan.problems) console.log(`  PROBLEM: ${p}`);
if (dryRun) process.exit(plan.problems.length ? 2 : 0);
const r = launch(plan);
console.log(r.message);
if (!r.started) process.exit(2);
if (plan.controls) {
  console.log('Keys: P pause/resume · J/L slower/faster · HOME normal speed · F6/F7 back/forward 30 s');
  if (noWait) console.log('Not waiting: your own keys are put back the next time you play a demo (or with --restore).');
  else console.log(await waitAndRestore(found.game.cstrikeDir, { log: console.log }));
}
