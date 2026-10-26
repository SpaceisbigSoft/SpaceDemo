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
    expect(started).toEqual(['-applaunch', '10', '-insecure', '+exec', 'cdf_test/cdf_controls.cfg', '+viewdemo', 'cdf_test/i69_vs_MoD']);
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


import { controlsConfig, prepareControls, readSettings, restoreControls, restoreSettings, DEFAULT_KEYS } from '../src/launch/controls.js';
import { waitAndRestore } from '../src/launch/launch.js';

// The start of the owner's config.cfg (2026-10-26), shortened; CRLF like the game writes it.
const ownerConfig = ['// This file is overwritten whenever you change your user settings in the game.', 'unbindall', 'bind "TAB" "+showscores"',
  'bind "k" "+voicerecord"', 'bind "PAUSE" "pause"', '_cl_autowepswitch "1"', 'voice_scale "0.750000"', 'volume "0.8"', ''].join('\r\n');

describe('playback keys (3.3)', () => {
  it('builds the controls file with speed steps, pause toggle and skips', () => {
    const cfg = controlsConfig();
    expect(cfg).toContain('alias cdf_s0 "dem_speed 0.25; alias cdf_slower cdf_s0; alias cdf_faster cdf_s1; echo CDF speed x1/4"');
    expect(cfg).toContain('alias cdf_s4 "dem_speed 4; alias cdf_slower cdf_s3; alias cdf_faster cdf_s4; echo CDF speed x4"');
    expect(cfg).toContain('alias cdf_slower cdf_s1');
    expect(cfg).toContain('bind "p" "cdf_pp"');
    expect(cfg).toContain('alias cdf_fwd "dem_jump 30; dem_pause 0; alias cdf_pp cdf_pause; echo CDF forward 30 s"');
    expect(cfg).not.toMatch(/voice_scale/);
    const muted = controlsConfig({ muteVoiceInSlowMotion: true, voiceScale: '0.750000' });
    expect(muted).toContain('dem_speed 0.5; voice_scale 0;');
    expect(muted).toContain('dem_speed 2; voice_scale 0.750000;');
    // Only console-safe characters, nothing that changes anything outside the demo player.
    for (const line of cfg.trim().split('\r\n').slice(1)) expect(line).toMatch(/^(alias cdf_|bind "|echo CDF)/);
  });
  it('the default keys are free in the owner\'s config', () => {
    const { binds, voiceScale } = readSettings(ownerConfig, Object.values(DEFAULT_KEYS));
    expect(Object.values(binds).every((b) => b === null)).toBe(true);
    expect(voiceScale).toBe('0.750000');
    expect(readSettings(ownerConfig, ['K']).binds).toEqual({ k: '+voicerecord' });
  });
  it('puts keys and voice_scale back, keeping everything else the game wrote', () => {
    const saved = { binds: { p: null, k: '+voicerecord' }, voiceScale: '0.750000' };
    const after = ownerConfig.replace('bind "PAUSE" "pause"', 'bind "PAUSE" "pause"\r\nbind "p" "cdf_pp"').replace('bind "k" "+voicerecord"', 'bind "k" "cdf_faster"')
      .replace('voice_scale "0.750000"', 'voice_scale "0.000000"').replace('volume "0.8"', 'volume "0.5"');
    const back = restoreSettings(after, saved);
    expect(back).toBe(ownerConfig.replace('volume "0.8"', 'volume "0.5"'));
    // A bound key whose line went missing comes back after the other binds.
    expect(restoreSettings(ownerConfig.replace('bind "k" "+voicerecord"\r\n', ''), saved)).toContain('bind "PAUSE" "pause"\r\nbind "k" "+voicerecord"\r\n_cl_autowepswitch');
    expect(restoreSettings('bind "a" "x"\nvoice_scale "0"\n', { binds: {}, dropVoiceScale: true })).toBe('bind "a" "x"\n');
  });
  it('full session: prepare, the game changes config.cfg, restore after it closes', async () => {
    const pc = fakePc();
    const cs = join(pc.game, 'cstrike');
    writeFileSync(join(cs, 'config.cfg'), ownerConfig, 'latin1');
    const { execPath, session } = prepareControls(cs, { muteVoiceInSlowMotion: true }, new Date('2026-10-26T19:30:00Z'));
    expect(execPath).toBe('cdf_test/cdf_controls.cfg');
    expect(readFileSync(join(cs, 'cdf_test', 'cdf_controls.cfg'), 'latin1')).toContain('voice_scale 0.750000');
    expect(readFileSync(session.backupPath, 'latin1')).toBe(ownerConfig);
    // The game closes and writes our keys and a muted voice into config.cfg.
    const gameWrote = ownerConfig.replace('bind "PAUSE" "pause"', 'bind "F6" "cdf_back"\r\nbind "F7" "cdf_fwd"\r\nbind "HOME" "cdf_s2"\r\nbind "j" "cdf_slower"\r\nbind "l" "cdf_faster"\r\nbind "p" "cdf_pp"\r\nbind "PAUSE" "pause"').replace('voice_scale "0.750000"', 'voice_scale "0.000000"');
    writeFileSync(join(cs, 'config.cfg'), gameWrote, 'latin1');
    let states = [false, true, true, false];
    const msg = await waitAndRestore(cs, { gameRunning: () => (states.length > 1 ? states.shift()! : states[0]), sleep: async () => {} });
    expect(msg).toMatch(/back in config\.cfg/);
    expect(readFileSync(join(cs, 'config.cfg'), 'latin1')).toBe(ownerConfig);
    expect(restoreControls(cs).restored).toBe(false); // nothing left to do
    states = [];
  });
  it('launch adds +exec for viewdemo and sets the keys up; not for playdemo', () => {
    const pc = fakePc();
    const cs = join(pc.game, 'cstrike');
    writeFileSync(join(cs, 'config.cfg'), ownerConfig, 'latin1');
    const found = findGame({ steamDir: pc.steam, platform: 'linux' });
    const one = join(pc.root, 'one.dem');
    writeFileSync(one, buildTinyDemo(48));
    let started: string[] = [];
    launch(planLaunch(one, found.steam!, found.game!, { inspect: fakeInspect }), { gameRunning: () => false, start: (_e, a) => { started = a; } });
    expect(started).toEqual(['-applaunch', '10', '-insecure', '+exec', 'cdf_test/cdf_controls.cfg', '+viewdemo', 'cdf_test/one']);
    expect(existsSync(join(cs, 'cdf_test', 'cdf_session.json'))).toBe(true);
    const two = join(pc.root, 'two.dem');
    writeFileSync(two, buildTinyDemo(48, 2));
    expect(planLaunch(two, found.steam!, found.game!, { inspect: fakeInspect }).args).not.toContain('+exec');
  });
});
