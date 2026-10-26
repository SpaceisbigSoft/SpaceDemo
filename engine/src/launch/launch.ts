// Start a fixed demo in Steam's Counter-Strike 1.6 (plan 3.2).
//
// Anti-cheat safety rule (owner, mandatory): the game is started the normal way, through Steam
// (`steam.exe -applaunch 10 -insecure +viewdemo <demo>`), always with -insecure; nothing is injected or hooked, no game
// file is changed, renamed or replaced. The only thing written inside the game folder is the copy of the fixed demo, in
// our own folder cstrike\cdf_test\ (never over a stock file). The person's original demo is never touched
// (writeNewFile, engine/src/fix/safe-output.ts).
//
// viewdemo (timeline, pause, speed) is used for one-map demos; it can't follow a map change, so demos that change map
// use playdemo <demo> <speed> (spike 1.5).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { inspectDemo } from '../inspect.js';
import { writeNewFile } from '../fix/safe-output.js';
import { CS16_APP_ID, type GameInstall, type SteamInstall } from './steam.js';

/** Our own folder inside cstrike. Nothing else in the game folder is ever written. */
export const DEMO_FOLDER = 'cdf_test';

export type PlayMode = 'viewdemo' | 'playdemo';

export interface PlanOptions {
  /** 'auto' (default): viewdemo for one map, playdemo when the demo changes map. */
  mode?: PlayMode | 'auto';
  /** Playback speed for playdemo (1 = normal). viewdemo starts at x1; speed is changed with the controls (3.3). */
  speed?: number;
  /** Name for the copy inside cdf_test (default: from the file name). */
  name?: string;
  /** Replaceable in tests. Default: the demo inspector. */
  inspect?: (bytes: Uint8Array) => { networkProtocol: number; gameDir: string; maps: string[] };
}

export interface LaunchPlan {
  /** The fixed demo the person picked. */
  source: string;
  /** Where the game reads it from (inside cstrike\cdf_test). */
  target: string;
  /** True when target must be written (false when the source already is that file or an identical copy is there). */
  copyNeeded: boolean;
  /** The demo name as the game's console wants it: relative to cstrike, forward slashes, no .dem. */
  gamePath: string;
  mode: PlayMode;
  speed: number;
  maps: string[];
  steamExe: string;
  args: string[];
  problems: string[];
  notes: string[];
}

/** A name the game console reads as one word: letters, digits, _ and - only (spaces would split the command). */
export function safeDemoName(file: string): string {
  const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.dem$/i, '');
  const clean = base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return clean || 'demo';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith('..') && !rel.includes(':') && !rel.startsWith(sep);
}

/** The command-line arguments for steam.exe. -insecure is always there (anti-cheat safety rule). */
export function launchArgs(mode: PlayMode, gamePath: string, speed = 1): string[] {
  if (!/^[A-Za-z0-9_\-/]+$/.test(gamePath)) throw new Error(`Demo name "${gamePath}" has characters the game console can't take.`);
  const args = ['-applaunch', String(CS16_APP_ID), '-insecure', `+${mode}`, gamePath];
  if (mode === 'playdemo' && speed !== 1) args.push(String(speed));
  return args;
}

/** Works out what launching would do, without writing or starting anything. */
export function planLaunch(fixedDemo: string, steam: SteamInstall, game: GameInstall, options: PlanOptions = {}): LaunchPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const bytes = new Uint8Array(readFileSync(fixedDemo));
  const report = (options.inspect ?? inspectDemo)(bytes);
  if (report.networkProtocol !== 48) problems.push(`This demo is protocol ${report.networkProtocol}; today's CS 1.6 plays protocol 48. Fix it first (npm run fix).`);
  if (report.gameDir.toLowerCase() !== 'cstrike') problems.push(`This demo is for "${report.gameDir}", not Counter-Strike.`);
  const maps = report.maps;
  let mode: PlayMode = options.mode && options.mode !== 'auto' ? options.mode : maps.length > 1 ? 'playdemo' : 'viewdemo';
  if (mode === 'viewdemo' && maps.length > 1) notes.push(`This demo changes map (${maps.join(' → ')}); viewdemo can't follow a map change, playdemo can.`);
  const speed = options.speed ?? 1;
  if (!(speed > 0 && speed <= 20)) problems.push(`Speed ${speed} isn't usable (choose between 0.1 and 20).`);
  if (mode === 'viewdemo' && speed !== 1) notes.push('viewdemo starts at normal speed; change speed in the game with the playback keys.');

  const folder = join(game.cstrikeDir, DEMO_FOLDER);
  const src = resolve(fixedDemo);
  let real = src;
  try { real = realpathSync(src); } catch { /* keep */ }
  let target: string;
  let copyNeeded: boolean;
  if (existsSync(folder) && inside(real, realpathSync(folder)) && /\.dem$/i.test(real) && /^[A-Za-z0-9_\-/]+$/.test(relative(realpathSync(folder), real).replace(/\\/g, '/').replace(/\.dem$/i, ''))) {
    target = real; // already in our folder with a usable name: play it where it is
    copyNeeded = false;
  } else {
    target = join(folder, `${options.name ? safeDemoName(options.name) : safeDemoName(fixedDemo)}.dem`);
    copyNeeded = !(existsSync(target) && statSync(target).size === bytes.length && sha256(new Uint8Array(readFileSync(target))) === sha256(bytes));
    if (!copyNeeded) notes.push('An identical copy is already in the game\'s cdf_test folder; using it.');
  }
  const baseForGame = existsSync(folder) ? realpathSync(game.cstrikeDir) : game.cstrikeDir;
  const gamePath = relative(baseForGame, target).replace(/\\/g, '/').replace(/\.dem$/i, '');
  let args: string[] = [];
  try { args = launchArgs(mode, gamePath, speed); } catch (e) { problems.push((e as Error).message); }
  return { source: src, target, copyNeeded, gamePath, mode, speed, maps, steamExe: steam.exe, args, problems, notes };
}

/** tasklist /FO CSV output lists hl.exe. */
export function isHlRunning(tasklistOutput: string): boolean {
  return /"hl\.exe"/i.test(tasklistOutput);
}

/** Is Counter-Strike (hl.exe) already running? Steam doesn't pass a new demo to a game that is already open
 *  (owner's test 2026-10-26: a second launch while the game was open did nothing). */
export function isGameRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq hl.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
    return isHlRunning(out);
  } catch {
    return false;
  }
}

export interface LaunchResult { started: boolean; message: string }

/** Copies the demo into cdf_test (if needed) and asks Steam to start the game with it. */
export function launch(plan: LaunchPlan, deps: { gameRunning?: () => boolean; start?: (exe: string, args: string[]) => void } = {}): LaunchResult {
  if (plan.problems.length) return { started: false, message: plan.problems.join(' ') };
  if ((deps.gameRunning ?? isGameRunning)()) {
    return { started: false, message: 'Counter-Strike is already open. Close it first: Steam won\'t hand a new demo to a game that is already running.' };
  }
  if (plan.copyNeeded) {
    mkdirSync(resolve(plan.target, '..'), { recursive: true });
    // Only ever replaces an earlier copy in our own cdf_test folder, never the person's original.
    writeNewFile([plan.source], plan.target, new Uint8Array(readFileSync(plan.source)), { overwrite: true });
  }
  const start = deps.start ?? ((exe, args) => { spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(); });
  start(plan.steamExe, plan.args);
  return { started: true, message: `Starting Counter-Strike with ${plan.mode} ${plan.gamePath}${plan.args.length > 5 ? ` at x${plan.speed}` : ''}.` };
}
