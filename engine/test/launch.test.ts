import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVdf, vdfString, vdfObject } from '../src/launch/vdf.js';
import { findGame, findSteam, parseRegQuery, steamLibraries } from '../src/launch/steam.js';
import { isHlRunning, launch, launchArgs, planLaunch, safeDemoName } from '../src/launch/launch.js';

// A stand-in for the demo inspector: the fake demo's first byte is its protocol, the second its number of maps.
const buildTinyDemo = (protocol: number, maps = 1) => new Uint8Array([protocol, maps, 1, 2, 3]);
const fakeInspect = (b: Uint8Array) => ({ networkProtocol: b[0], gameDir: 'cstrike', maps: ['de_train', 'de_nuke', 'de_dust'].slice(0, b[1]) });

// libraryfolders.vdf and appmanifest_10.acf shaped like the owner's real files (2026-10-26), ids and sizes shortened.
const libraryVdf = (c: string, d: string) => `"libraryfolders"
{
	"0"
	{
		"path"		"${c.replace(/\\/g, '\\\\')}"
		"label"		""
		"apps"
		{
			"228980"		"288469846"
		}
	}
	"1"
	{
		"path"		"${d.replace(/\\/g, '\\\\')}"
		"label"		""
		"apps"
		{
			"730"		"1"
		}
	}
}
`;
const manifest10 = `"AppState"
{
	"appid"		"10"
	"LauncherPath"		"C:\\\\Program Files (x86)\\\\Steam\\\\steam.exe"
	"name"		"Counter-Strike"
	"StateFlags"		"4"
	"installdir"		"Half-Life"
	"buildid"		"12934623"
	"UserConfig"
	{
		"language"		"english"
		"BetaKey"		"public"
	}
}
`;

function fakePc(): { root: string; steam: string; lib: string; game: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdf-launch-'));
  const steam = join(root, 'Steam'), lib = join(root, 'SteamLibrary');
  mkdirSync(join(steam, 'steamapps'), { recursive: true });
  writeFileSync(join(steam, 'steam.exe'), 'x');
  writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), libraryVdf(steam, lib));
  const game = join(lib, 'steamapps', 'common', 'Half-Life');
  mkdirSync(join(game, 'cstrike'), { recursive: true });
  writeFileSync(join(game, 'hl.exe'), 'x');
  writeFileSync(join(game, 'cstrike', 'steam.inf'), 'PatchVersion=1.1.2.7\r\nProductName=cstrike\r\n');
  writeFileSync(join(lib, 'steamapps', 'appmanifest_10.acf'), manifest10);
  return { root, steam, lib, game };
}

describe('VDF reader', () => {
  it('reads nested blocks, escapes, comments and conditions', () => {
    const v = parseVdf('// c\n"A"\n{\n "path" "D:\\\\Steam Library"\n "q" "say \\"hi\\""\n "B" { "x" "1" [$WIN32] }\n}\n');
    const a = vdfObject(v, 'a');
    expect(vdfString(a, 'PATH')).toBe('D:\\Steam Library');
    expect(vdfString(a, 'q')).toBe('say "hi"');
    expect(vdfString(vdfObject(a, 'b'), 'x')).toBe('1');
  });
  it('rejects broken files', () => {
    expect(() => parseVdf('"a" { "b" "c"')).toThrow(/ends inside/);
  });
});

describe('registry output', () => {
  it('reads reg.exe query output', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
    expect(parseRegQuery(out, 'SteamPath')).toBe('c:/program files (x86)/steam');
    expect(parseRegQuery(out, 'SteamExe')).toBeUndefined();
  });
  it('reads the owner\'s real reg.exe and tasklist output (2026-10-26)', () => {
    const real = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam\r\n    InstallPath    REG_SZ    C:\\Program Files (x86)\\Steam\r\n\r\n';
    expect(parseRegQuery(real, 'InstallPath')).toBe('C:\\Program Files (x86)\\Steam');
    expect(isHlRunning('"hl.exe","15904","Console","1","259,268 K"\r\n')).toBe(true);
    expect(isHlRunning('INFO: No tasks are running which match the specified criteria.\r\n')).toBe(false);
  });
});

describe('finding Steam and CS 1.6 (3.1)', () => {
  it('finds the game in a second library even when libraryfolders.vdf does not list app 10 (owner\'s PC)', () => {
    const pc = fakePc();
    const r = findGame({ registry: (k, v) => (v === 'SteamPath' ? pc.steam : undefined), platform: 'linux' });
    expect(r.problems).toEqual([]);
    expect(r.steam?.source).toBe('registry');
    expect(r.libraries).toEqual([pc.steam, pc.lib]);
    expect(r.game?.dir).toBe(pc.game);
    expect(r.game?.patchVersion).toBe('1.1.2.7');
    expect(r.game?.manifest?.buildId).toBe('12934623');
    expect(r.notes).toEqual([]);
  });
  it('falls back to the usual folders, then reports plainly', () => {
    const pc = fakePc();
    expect(findSteam({ registry: () => undefined, commonSteamDirs: ['/nope', pc.steam], platform: 'linux' }).steam?.source).toBe('common-folder');
    const none = findGame({ registry: () => undefined, commonSteamDirs: [], platform: 'linux' });
    expect(none.steam).toBeUndefined();
    expect(none.problems[0]).toMatch(/Steam wasn't found/);
  });
  it('accepts a manual game folder and checks it', () => {
    const pc = fakePc();
    expect(findGame({ gameDir: pc.game, registry: () => undefined, commonSteamDirs: [], platform: 'linux' }).game?.source).toBe('manual');
    const bad = findGame({ gameDir: pc.lib, steamDir: pc.steam, platform: 'linux' });
    expect(bad.game).toBeUndefined();
    expect(bad.problems[0]).toMatch(/no hl\.exe/);
  });
  it('notes a beta branch and an unfinished install', () => {
    const pc = fakePc();
    writeFileSync(join(pc.lib, 'steamapps', 'appmanifest_10.acf'), manifest10.replace('"4"', '"6"').replace('"public"', '"steam_legacy"'));
    const r = findGame({ steamDir: pc.steam, platform: 'linux' });
    expect(r.notes.join(' ')).toMatch(/update/);
    expect(r.notes.join(' ')).toMatch(/steam_legacy/);
  });
  it('reads the old libraryfolders layout', () => {
    const pc = fakePc();
    writeFileSync(join(pc.steam, 'steamapps', 'libraryfolders.vdf'), `"LibraryFolders"\n{\n "TimeNextStatsReport" "1"\n "1" "${pc.lib}"\n}\n`);
    expect(steamLibraries(pc.steam, 'linux')).toEqual([pc.steam, pc.lib]);
  });
});

describe('launching (3.2)', () => {
  it('always passes -insecure and only console-safe names', () => {
    expect(launchArgs('viewdemo', 'cdf_test/MoD_CTside')).toEqual(['-applaunch', '10', '-insecure', '+viewdemo', 'cdf_test/MoD_CTside']);
    expect(launchArgs('playdemo', 'cdf_test/x', 2)).toEqual(['-applaunch', '10', '-insecure', '+playdemo', 'cdf_test/x', '2']);
    expect(() => launchArgs('viewdemo', 'cdf_test/a b')).toThrow();
    expect(safeDemoName('C:\\d\\i69 vs MoD (de_train).dem')).toBe('i69_vs_MoD_de_train');
  });
  it('copies the fixed demo into cdf_test, never touches the original, starts Steam with the plan', () => {
    const pc = fakePc();
    const found = findGame({ steamDir: pc.steam, platform: 'linux' });
    const demoBytes = buildTinyDemo(48);
    const original = join(pc.root, 'my demos', 'i69 vs MoD.dem');
    mkdirSync(join(pc.root, 'my demos'));
    writeFileSync(original, demoBytes);
    const plan = planLaunch(original, found.steam!, found.game!, { inspect: fakeInspect });
    expect(plan.problems).toEqual([]);
    expect(plan.mode).toBe('viewdemo');
    expect(plan.gamePath).toBe('cdf_test/i69_vs_MoD');
    expect(plan.copyNeeded).toBe(true);
    let started: string[] = [];
    const r = launch(plan, { gameRunning: () => false, start: (_e, a) => { started = a; } });
    expect(r.started).toBe(true);
    expect(r.message).toMatch(/demo panel/);
    expect(started).toEqual(['-applaunch', '10', '-insecure', '+viewdemo', 'cdf_test/i69_vs_MoD']);
    expect(readFileSync(join(pc.game, 'cstrike', 'cdf_test', 'i69_vs_MoD.dem'))).toEqual(Buffer.from(demoBytes));
    expect(readFileSync(original)).toEqual(Buffer.from(demoBytes));
    // Second time: identical copy is reused; a demo already inside cdf_test plays in place.
    expect(planLaunch(original, found.steam!, found.game!, { inspect: fakeInspect }).copyNeeded).toBe(false);
    const inPlace = planLaunch(join(pc.game, 'cstrike', 'cdf_test', 'i69_vs_MoD.dem'), found.steam!, found.game!, { inspect: fakeInspect });
    expect(inPlace.copyNeeded).toBe(false);
    expect(inPlace.gamePath).toBe('cdf_test/i69_vs_MoD');
  });
  it('uses playdemo for a demo that changes map, with the speed', () => {
    const pc = fakePc();
    const found = findGame({ steamDir: pc.steam, platform: 'linux' });
    const two = join(pc.root, 'two.dem');
    writeFileSync(two, buildTinyDemo(48, 2));
    const plan = planLaunch(two, found.steam!, found.game!, { inspect: fakeInspect, speed: 2 });
    expect(plan.mode).toBe('playdemo');
    expect(plan.args).toEqual(['-applaunch', '10', '-insecure', '+playdemo', 'cdf_test/two', '2']);
  });
  it('refuses unfixed demos and a running game', () => {
    const pc = fakePc();
    const found = findGame({ steamDir: pc.steam, platform: 'linux' });
    const old = join(pc.root, 'old.dem');
    writeFileSync(old, buildTinyDemo(46));
    const plan = planLaunch(old, found.steam!, found.game!, { inspect: fakeInspect });
    expect(plan.problems[0]).toMatch(/protocol 46/);
    expect(launch(plan, { gameRunning: () => false, start: () => { throw new Error('must not start'); } }).started).toBe(false);
    const good = join(pc.root, 'good.dem');
    writeFileSync(good, buildTinyDemo(48));
    const r = launch(planLaunch(good, found.steam!, found.game!, { inspect: fakeInspect }), { gameRunning: () => true, start: () => { throw new Error('must not start'); } });
    expect(r.started).toBe(false);
    expect(r.message).toMatch(/already open/);
    expect(existsSync(join(pc.game, 'cstrike', 'cdf_test', 'good.dem'))).toBe(false);
  });
});

