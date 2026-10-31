// App settings file and game status (plan 4.2). Runs with the normal `npm test`.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, settingsFile } from '../main/settings.js';
import { toGameStatus } from '../main/game.js';

describe('app settings', () => {
  it('starts with the defaults when there is no file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-set-'));
    expect(loadSettings(settingsFile(dir))).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
  });

  it('saves and loads the theme', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-set-'));
    const f = settingsFile(join(dir, 'new folder'));
    const next = { theme: 'light' as const, libraryFolders: ['D:\\Demos'], mapFolders: [], voiceCleanup: false, gameDir: 'E:\\Games\\Half-Life', playerMerges: { 'Old Name': 'New Name' }, playerRejected: ['a|b'] };
    saveSettings(f, next);
    expect(loadSettings(f)).toEqual(next);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(next);
  });

  it('ignores damaged files and unknown values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-set-'));
    const f = settingsFile(dir);
    writeFileSync(f, '{ not json');
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ theme: 'purple', extra: 1 })).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(cleanSettings({ libraryFolders: ['a', 'a', 3, ''], mapFolders: 'x' })).toEqual({ ...DEFAULT_SETTINGS, libraryFolders: ['a'] });
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.voiceCleanup).toBe(true);
    expect(cleanSettings({ voiceCleanup: 'no', gameDir: '' })).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ playerMerges: { a: 'a', b: 3, c: 'd' }, playerRejected: 'x' })).toEqual({ ...DEFAULT_SETTINGS, playerMerges: { c: 'd' } });
  });
});

describe('game status for the window', () => {
  it('reports the owner-style install', () => {
    const s = toGameStatus({
      steam: { dir: 'c:\\program files (x86)\\steam', exe: 'c:\\program files (x86)\\steam\\steam.exe', source: 'registry' },
      game: {
        dir: 'D:\\SteamLibrary\\steamapps\\common\\Half-Life',
        cstrikeDir: 'D:\\SteamLibrary\\steamapps\\common\\Half-Life\\cstrike',
        hlExe: 'D:\\SteamLibrary\\steamapps\\common\\Half-Life\\hl.exe',
        source: 'steam-library',
        library: 'D:\\SteamLibrary',
        manifest: { buildId: '12934623' },
        patchVersion: '1.1.2.7',
      },
      libraries: [],
      problems: [],
      notes: [],
    });
    expect(s).toMatchObject({ found: true, library: 'D:\\SteamLibrary', version: '1.1.2.7', buildId: '12934623' });
  });

  it('reports a missing game with its problems', () => {
    const s = toGameStatus({ libraries: [], problems: ['Steam was not found.'], notes: [] });
    expect(s.found).toBe(false);
    expect(s.problems).toEqual(['Steam was not found.']);
  });
});
