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
      'addMapFolder', 'addToLibrary', 'checkForUpdate', 'chooseAiModel', 'chooseGameFolder', 'chooseOutputFolder', 'chooseSpeechModel', 'clearGameFolder', 'downloadAiModel', 'downloadSpeechModel', 'downloadUpdate', 'findGame',
      'fixDemos', 'fixFiles', 'getAiModel', 'getCombined', 'getDemoDetails', 'getFixBatch', 'getLibrary', 'getPlayers', 'getReplay', 'getSettings', 'getSpeechModel', 'getTheme',
      'getTranscript', 'getUpdate', 'getWatchInfo', 'info', 'installUpdate', 'mergePlayers', 'onAiModel', 'onFixBatch', 'onLibraryChanged', 'onOpenDemo', 'onPlayersChanged', 'onSpeechModel',
      'onThemeChanged', 'onTranscript', 'onUpdate', 'onWatchProgress', 'openLicence', 'openOutputFolder', 'pathForFile', 'rejectPlayerSuggestion', 'removeFromLibrary', 'removeMapFolder', 'rescanLibrary', 'setAiVoice',
      'setCpuCores', 'setTheme', 'setUpdateCheck', 'setVoiceCleanup', 'showInFolder', 'startTranscript', 'stopFixing', 'stopTranscript', 'takeOpenDemo', 'unmergePlayer', 'watch',
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

  it('Settings: processor cores (suggested maximum by default) and the voice-to-text accuracy note', async () => {
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector('[data-testid="cpu-cores"] option', { state: 'attached' });
    const view = await page.evaluate(() => window.spacedemo.getSettings());
    expect(view.cpu.chosen).toBe(false);
    expect(view.cpu.suggested).toBe(Math.max(1, view.cpu.max - 1));
    expect(Number(await page.inputValue('[data-testid="cpu-cores"]'))).toBe(view.cpu.suggested);
    expect(await page.locator('[data-testid="cpu-cores"] option').count()).toBe(view.cpu.max);
    expect(await page.textContent('[data-testid="cpu-note"]')).toContain('Suggested maximum');
    expect(await page.textContent('[data-testid="speech-accuracy"]')).toMatch(/can come out wrong/);
    const chosen = await page.evaluate(() => window.spacedemo.setCpuCores(1));
    expect(chosen.cpu).toMatchObject({ cores: 1, chosen: true });
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).cpuCores).toBe(1);
    const back = await page.evaluate(() => window.spacedemo.setCpuCores(null));
    expect(back.cpu).toMatchObject({ cores: view.cpu.suggested, chosen: false });
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).cpuCores).toBeUndefined();
    await page.locator('[data-testid="settings-cpu"]').scrollIntoViewIfNeeded();
    await shot('5b settings processor cores');
  });

  it('Help page (6.3): getting started, demo panel, troubleshooting, link to the full guide', async () => {
    await page.click('nav button:has-text("Help")');
    await page.waitForSelector('#help-start');
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Help');
    for (const id of ['help-start', 'help-panel', 'help-voice', 'help-maps', 'help-trouble', 'help-safe']) expect(await page.isVisible(`#${id}`)).toBe(true);
    expect(await page.getAttribute('[data-testid="help-guide"]', 'href')).toBe('https://github.com/SpaceisbigSoft/SpaceDemo/blob/main/docs/USER-GUIDE.md');
    await shot('5e help');
    await page.click('#help-start ~ ol button:has-text("Library")');
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Library');
  });

  it('Settings → Updates (6.7): switch saved, development copy says updates work in the installed app', async () => {
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector('[data-testid="settings-updates"]');
    expect(await page.textContent('[data-testid="update-status"]')).toContain('installed SpaceDemo');
    expect(await page.isDisabled('[data-testid="update-check-now"]')).toBe(true);
    expect(await page.isChecked('[data-testid="update-check"]')).toBe(true);
    await page.click('[data-testid="update-check"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).updateCheck).toBe(false);
    await page.click('[data-testid="update-check"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).updateCheck).toBe(true);
    expect(await page.isVisible('[data-testid="update-banner"]')).toBe(false);
    await page.locator('[data-testid="settings-updates"]').scrollIntoViewIfNeeded();
    await shot('5f settings updates');
  });

  it('Settings → About: credits and licence buttons (6.4)', async () => {
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector('[data-testid="open-notices"]');
    expect(await page.textContent('#about-h + dl')).toMatch(/Speex.*Opus.*Whisper.*Electron.*not affiliated with Valve/s);
    expect(await page.isVisible('[data-testid="open-licence"]')).toBe(true);
    await page.locator('[data-testid="open-notices"]').scrollIntoViewIfNeeded();
    await shot('5d settings about');
  });

  it('Settings: AI voice enhancement (5.g5): off by default, switch, model file, credits', async () => {
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector('[data-testid="ai-voice"]');
    expect(await page.isChecked('[data-testid="ai-voice"]')).toBe(false);
    expect(await page.textContent('[data-testid="ai-missing"]')).toContain('downloaded once');
    expect(await page.textContent('[data-testid="credit-ai"]')).toMatch(/Haohe Liu.*CC BY 4\.0.*changed/s);
    await page.click('[data-testid="ai-voice"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).aiVoice).toBe(true);
    await page.waitForSelector('[data-testid="ai-missing"].problem'); // on, but no model yet: says the plain voice is used
    expect((await page.evaluate(() => window.spacedemo.getSettings())).aiVoice).toEqual({ on: true, active: false });
    const model = process.env.CDF_AI_MODEL;
    if (model) {
      const s = await page.evaluate((p) => window.spacedemo.chooseAiModel(p), model);
      expect(s).toMatchObject({ path: model, chosenByHand: true });
      await page.waitForSelector('[data-testid="ai-ready"]');
      expect((await page.evaluate(() => window.spacedemo.getSettings())).aiVoice).toEqual({ on: true, active: true });
    }
    await page.locator('[data-testid="settings-ai"]').scrollIntoViewIfNeeded();
    await shot('5c settings AI voice');
    await page.click('[data-testid="ai-voice"]');
    await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).aiVoice).toBe(false);
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
