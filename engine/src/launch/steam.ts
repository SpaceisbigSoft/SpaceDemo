// Find Steam and the Steam copy of Counter-Strike 1.6 (plan 3.1). Read-only: nothing here writes, starts or changes anything.
//
// Order (each step only when the one before found nothing):
//   Steam:  manual choice → registry HKCU\Software\Valve\Steam (SteamPath / SteamExe) → HKLM ...\Valve\Steam InstallPath
//           → the usual folders (C:\Program Files (x86)\Steam, C:\Program Files\Steam).
//   Game:   manual choice (the Half-Life folder) → every Steam library folder (Steam's own folder + those listed in
//           steamapps\libraryfolders.vdf) that has steamapps\appmanifest_10.acf → <library>\steamapps\common\<installdir>.
// Found on the owner's PC (2026-10-26): libraryfolders.vdf does NOT list app 10 under D:\SteamLibrary although the game is
// installed there, so the "apps" list in that file is not trusted; each library is checked for the manifest itself.
// A game folder counts as CS 1.6 when it has hl.exe and a cstrike folder (cstrike\liblist.gam or cstrike\steam.inf).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { parseVdf, vdfObject, vdfString, type VdfObject } from './vdf.js';

export const CS16_APP_ID = 10;

/** Reads one registry value (Windows). Returns undefined when the key or value doesn't exist. Replaceable in tests. */
export type RegistryReader = (key: string, value: string) => string | undefined;

export interface FindOptions {
  /** Steam folder chosen by the person (overrides the search). */
  steamDir?: string;
  /** Half-Life game folder chosen by the person (the folder with hl.exe and cstrike). */
  gameDir?: string;
  registry?: RegistryReader;
  /** Folders to try when the registry has nothing. Defaults to the usual install places on Windows. */
  commonSteamDirs?: string[];
  platform?: NodeJS.Platform;
}

export interface SteamInstall {
  dir: string;
  exe: string;
  /** Where the folder came from. */
  source: 'manual' | 'registry' | 'common-folder' | 'game-manifest';
}

export interface GameInstall {
  /** The Half-Life folder (has hl.exe and cstrike). */
  dir: string;
  cstrikeDir: string;
  hlExe: string;
  source: 'manual' | 'steam-library';
  /** The Steam library folder it was found in. */
  library?: string;
  /** From appmanifest_10.acf. */
  manifest?: {
    name?: string;
    installdir?: string;
    buildId?: string;
    stateFlags?: number;
    betaKey?: string;
    launcherPath?: string;
  };
  /** cstrike\steam.inf PatchVersion, e.g. "1.1.2.7". */
  patchVersion?: string;
}

export interface FindResult {
  steam?: SteamInstall;
  game?: GameInstall;
  /** All Steam library folders that were checked. */
  libraries: string[];
  /** Plain-language problems that stop playback (empty = ready). */
  problems: string[];
  /** Plain-language notes that don't stop playback. */
  notes: string[];
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}
function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Registry paths use forward slashes and lower case ("c:/program files (x86)/steam"); make them a normal path. */
function cleanPath(p: string, platform: NodeJS.Platform): string {
  const t = p.trim().replace(/^"|"$/g, '');
  return platform === 'win32' ? normalize(t.replace(/\//g, '\\')).replace(/\\+$/, '') : t.replace(/\/+$/, '');
}

/** The default registry reader: Windows' own reg.exe (read-only query). */
export function windowsRegistry(key: string, value: string): string | undefined {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return parseRegQuery(out, value);
  } catch {
    return undefined; // key or value missing
  }
}

/** Value from `reg query <key> /v <value>` output: "    SteamPath    REG_SZ    c:/program files (x86)/steam". */
export function parseRegQuery(output: string, value: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line) ?? /^\s+(.+?)\s+(REG_\w+)\s+(.*)$/.exec(line);
    if (m && m[1].toLowerCase() === value.toLowerCase()) return m[3].trim();
  }
  return undefined;
}

function steamAt(dir: string, source: SteamInstall['source'], _platform: NodeJS.Platform): SteamInstall | undefined {
  const exe = join(dir, 'steam.exe');
  return isFile(exe) ? { dir, exe, source } : undefined;
}

export function findSteam(options: FindOptions = {}): { steam?: SteamInstall; problems: string[] } {
  const platform = options.platform ?? process.platform;
  const problems: string[] = [];
  if (options.steamDir) {
    const dir = cleanPath(options.steamDir, platform);
    const s = steamAt(dir, 'manual', platform);
    if (s) return { steam: s, problems };
    problems.push(`The Steam folder you chose (${dir}) has no steam.exe.`);
    return { problems };
  }
  const reg = options.registry ?? (platform === 'win32' ? windowsRegistry : () => undefined);
  const fromRegistry = [
    reg('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    (() => { const e = reg('HKCU\\Software\\Valve\\Steam', 'SteamExe'); return e ? e.replace(/[\\/][^\\/]*$/, '') : undefined; })(),
    reg('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    reg('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
  ];
  for (const p of fromRegistry) {
    if (!p) continue;
    const s = steamAt(cleanPath(p, platform), 'registry', platform);
    if (s) return { steam: s, problems };
  }
  const common = options.commonSteamDirs ?? (platform === 'win32'
    ? [`${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Steam`, `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Steam`]
    : []);
  for (const p of common) {
    const s = steamAt(cleanPath(p, platform), 'common-folder', platform);
    if (s) return { steam: s, problems };
  }
  return { problems };
}

/** Steam's own folder plus every library listed in steamapps\libraryfolders.vdf (old and new file layouts). */
export function steamLibraries(steamDir: string, platform: NodeJS.Platform = process.platform): string[] {
  const libs = [steamDir];
  const files = [join(steamDir, 'steamapps', 'libraryfolders.vdf'), join(steamDir, 'config', 'libraryfolders.vdf')];
  for (const f of files) {
    if (!isFile(f)) continue;
    let root: VdfObject;
    try { root = parseVdf(readFileSync(f, 'utf8')); } catch { continue; }
    const lf = vdfObject(root, 'libraryfolders') ?? vdfObject(root, 'LibraryFolders');
    if (!lf) continue;
    for (const [k, v] of Object.entries(lf)) {
      if (!/^\d+$/.test(k)) continue; // skip "contentstatsid", "TimeNextStatsReport"
      const p = typeof v === 'string' ? v : vdfString(v, 'path'); // old layout: "1" "D:\\SteamLibrary"
      if (p) libs.push(cleanPath(p, platform));
    }
  }
  const seen = new Set<string>();
  return libs.filter((l) => {
    const k = platform === 'win32' ? resolve(l).toLowerCase() : resolve(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function readManifest(file: string): GameInstall['manifest'] | undefined {
  try {
    const app = vdfObject(parseVdf(readFileSync(file, 'utf8')), 'AppState');
    if (!app) return undefined;
    const flags = vdfString(app, 'StateFlags');
    return {
      name: vdfString(app, 'name'),
      installdir: vdfString(app, 'installdir'),
      buildId: vdfString(app, 'buildid'),
      stateFlags: flags !== undefined && /^\d+$/.test(flags) ? Number(flags) : undefined,
      betaKey: vdfString(vdfObject(app, 'UserConfig'), 'BetaKey') ?? vdfString(vdfObject(app, 'MountedConfig'), 'BetaKey'),
      launcherPath: vdfString(app, 'LauncherPath'),
    };
  } catch {
    return undefined;
  }
}

function readPatchVersion(cstrikeDir: string): string | undefined {
  try {
    const m = /^PatchVersion=(.*)$/m.exec(readFileSync(join(cstrikeDir, 'steam.inf'), 'utf8'));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Checks a Half-Life folder. Returns the reason it isn't usable, or undefined when it is. */
export function checkGameDir(dir: string): string | undefined {
  if (!isDir(dir)) return `The folder ${dir} doesn't exist.`;
  if (!isFile(join(dir, 'hl.exe'))) return `${dir} has no hl.exe, so it isn't the Half-Life / Counter-Strike game folder.`;
  const cs = join(dir, 'cstrike');
  if (!isDir(cs)) return `${dir} has no cstrike folder: Counter-Strike isn't installed there.`;
  if (!isFile(join(cs, 'liblist.gam')) && !isFile(join(cs, 'steam.inf'))) return `${cs} looks incomplete (no liblist.gam or steam.inf).`;
  return undefined;
}

export function findGame(options: FindOptions = {}): FindResult {
  const platform = options.platform ?? process.platform;
  const problems: string[] = [];
  const notes: string[] = [];
  const s = findSteam(options);
  problems.push(...s.problems);
  let steam = s.steam;
  let libraries: string[] = steam ? steamLibraries(steam.dir, platform) : [];
  let game: GameInstall | undefined;

  if (options.gameDir) {
    const dir = cleanPath(options.gameDir, platform);
    const why = checkGameDir(dir);
    if (why) problems.push(`The game folder you chose: ${why}`);
    else game = { dir, cstrikeDir: join(dir, 'cstrike'), hlExe: join(dir, 'hl.exe'), source: 'manual', patchVersion: readPatchVersion(join(dir, 'cstrike')) };
  } else if (steam) {
    for (const lib of libraries) {
      const mf = join(lib, 'steamapps', `appmanifest_${CS16_APP_ID}.acf`);
      if (!isFile(mf)) continue;
      const manifest = readManifest(mf);
      const dir = join(lib, 'steamapps', 'common', manifest?.installdir || 'Half-Life');
      const why = checkGameDir(dir);
      if (why) { notes.push(`Steam has a Counter-Strike record in ${lib}, but ${why}`); continue; }
      game = { dir, cstrikeDir: join(dir, 'cstrike'), hlExe: join(dir, 'hl.exe'), source: 'steam-library', library: lib, manifest, patchVersion: readPatchVersion(join(dir, 'cstrike')) };
      break;
    }
    if (!game) problems.push('Counter-Strike (Steam app 10) isn\'t installed in any of your Steam library folders. Install it in Steam, or choose the game folder by hand.');
  }

  // Steam not found by the usual ways, but the game's manifest names steam.exe (LauncherPath).
  if (!steam && game?.manifest?.launcherPath) {
    const exe = cleanPath(game.manifest.launcherPath, platform);
    if (isFile(exe)) steam = { dir: exe.replace(/[\\/][^\\/]*$/, ''), exe, source: 'game-manifest' };
  }
  if (!steam && !s.problems.length) problems.unshift('Steam wasn\'t found. Install Steam, or choose the Steam folder by hand.');
  if (steam && !libraries.length) libraries = steamLibraries(steam.dir, platform);

  const m = game?.manifest;
  if (m?.stateFlags !== undefined) {
    // Steam app state bits: 2 = update required, 4 = fully installed, 256/512/1024 = update running/paused/started.
    if (!(m.stateFlags & 4)) notes.push('Steam says Counter-Strike isn\'t fully installed yet (an install or update may still be running).');
    else if (m.stateFlags & (2 | 256 | 512 | 1024)) notes.push('Steam has an update for Counter-Strike waiting or running; it may update before it starts.');
  }
  if (m?.betaKey && m.betaKey.toLowerCase() !== 'public') notes.push(`Counter-Strike is on the Steam beta branch "${m.betaKey}" (the fixed demos are made for the normal branch).`);
  return { steam, game, libraries, problems, notes };
}
