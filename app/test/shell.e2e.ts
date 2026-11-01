// App shell interface test (plan 4.2): the real window, with its own empty data folder.
// Screenshots go to out/screenshots/ (set SPACEDEMO_SHOTS=0 to skip them).
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const shots = join(root, 'out', 'screenshots');
const takeShots = process.env.SPACEDEMO_SHOTS !== '0';
const dataDir = mkdtempSync(join(tmpdir(), 'spacedemo-e2e-'));

let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    executablePath: (await import('electron')).default as unknown as string,
    env: { ...process.env, SPACEDEMO_USER_DATA: dataDir },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="page-library"]');
}

async function shot(name: string): Promise<void> {
  if (!takeShots) return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

describe('app shell', () => {
  beforeAll(launch);
  afterAll(async () => { await app?.close(); });

  it('opens one sandboxed window titled SpaceDemo on the library', async () => {
    expect(await page.title()).toBe('SpaceDemo');
    expect(app.windows()).toHaveLength(1);
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Library');
    expect(await page.getAttribute('nav button[aria-current="page"]', 'class')).toContain('nav-item');
    expect(await page.textContent('nav button[aria-current="page"]')).toContain('Library');
    // The window has no Node.js: only the bridge.
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => Object.keys(window.spacedemo).sort())).toEqual([
      'addMapFolder', 'addToLibrary', 'chooseGameFolder', 'chooseOutputFolder', 'chooseSpeechModel', 'clearGameFolder', 'downloadSpeechModel', 'findGame', 'fixDemos', 'fixFiles',
      'getCombined', 'getDemoDetails', 'getFixBatch', 'getLibrary', 'getPlayers', 'getReplay', 'getSettings', 'getSpeechModel', 'getTheme', 'getTranscript',
      'getWatchInfo', 'info', 'mergePlayers', 'onFixBatch', 'onLibraryChanged', 'onPlayersChanged', 'onSpeechModel', 'onThemeChanged', 'onTranscript', 'onWatchProgress',
      'openOutputFolder', 'pathForFile', 'rejectPlayerSuggestion', 'removeFromLibrary', 'removeMapFolder', 'rescanLibrary', 'setTheme', 'setVoiceCleanup', 'showInFolder', 'startTranscript',
      'stopFixing', 'stopTranscript', 'unmergePlayer', 'watch',
    ]);
    const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 14px Inter'); });
    expect(fontsOk).toBe(true);
  });

  it('shows the game card (found or not) and starts dark', async () => {
    await page.waitForFunction(() => !document.querySelector('[data-testid="game-card"]')?.textContent?.includes('Looking'));
    const text = await page.textContent('[data-testid="game-card"]');
    expect(text).toMatch(/Counter-Strike 1\.6(Found|Not found)/);
    expect(await page.evaluate(() => window.spacedemo.getTheme())).toEqual({ choice: 'dark', dark: true });
    expect(await bg()).toBe('rgb(21, 23, 26)');
    await shot('1 library (dark)');
  });

  it('moves between pages with the left navigation and the keyboard', async () => {
    await page.click('nav button:has-text("Fix & convert")');
    await page.waitForSelector('[data-testid="page-fix"]');
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Fix & convert');
    await shot('2 fix');

    await page.focus('nav button:has-text("Settings")');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="page-settings"]');
    expect(await page.textContent('[data-testid="app-version"]')).toMatch(/^SpaceDemo \d+\.\d+\.\d+/);

    await page.click('[data-testid="game-card"]');
    await page.waitForSelector('[data-testid="page-settings"]');
  });

  it('switches light and dark, and keeps the choice in the settings file', async () => {
    await page.click('[data-testid="page-settings"] label:has-text("Light")');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(244, 245, 247)');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).theme).toBe('light');
    await shot('3 settings (light)');
    await page.click('nav button:has-text("Library")');
    await shot('4 library (light)');

    await page.click('nav button:has-text("Settings")');
    await page.click('[data-testid="page-settings"] label:has-text("Dark")');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(21, 23, 26)');
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).theme).toBe('dark');
    await shot('5 settings (dark)');
  });

  it('remembers the theme after a restart', async () => {
    await page.click('[data-testid="page-settings"] label:has-text("Light")');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(244, 245, 247)');
    await app.close();
    await launch();
    expect(await bg()).toBe('rgb(244, 245, 247)');
    expect(await page.evaluate(() => window.spacedemo.getTheme())).toEqual({ choice: 'light', dark: false });
  });

  it('Settings: voice cleanup switch and the game folder by hand (4.7)', async () => {
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector('[data-testid="voice-cleanup"]');
    expect(await page.isChecked('[data-testid="voice-cleanup"]')).toBe(true);
    await page.click('[data-testid="voice-cleanup"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).voiceCleanup).toBe(false);
    await page.click('[data-testid="voice-cleanup"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).voiceCleanup).toBe(true);

    // A folder that isn't the game is refused with the reason.
    const bad = await page.evaluate((p) => window.spacedemo.chooseGameFolder(p), dataDir);
    expect(bad.problem).toMatch(/no hl\.exe/);
    expect(bad.gameDir).toBeUndefined();
    const game = process.env.SPACEDEMO_GAME_DIR;
    if (game) {
      const ok = await page.evaluate((p) => window.spacedemo.chooseGameFolder(p), game);
      expect(ok.problem).toBeUndefined();
      expect(ok.gameDir).toBe(game);
      const back = await page.evaluate(() => window.spacedemo.clearGameFolder());
      expect(back.gameDir).toBeUndefined();
    }
    // 5.v the speech model: not there yet; a file that isn't a model is refused with the reason.
    expect(await page.textContent('[data-testid="settings-speech"]')).toContain('Not downloaded yet');
    const notModel = await page.evaluate((p) => window.spacedemo.chooseSpeechModel(p), join(dataDir, 'settings.json'));
    expect(notModel.problem).toContain('not a speech model');
    await page.locator('[data-testid="settings-speech"]').scrollIntoViewIfNeeded();
    await shot('16 settings');
  });

  it('refuses unknown theme values and never opens new windows', async () => {
    expect((await page.evaluate(() => window.spacedemo.setTheme('purple' as never))).choice).toBe('light');
    await page.evaluate(() => { window.open('about:blank'); });
    await page.waitForTimeout(300);
    expect(app.windows()).toHaveLength(1);
  });
});
