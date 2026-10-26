// Library screen interface test (plan 4.3), on the real Set 1 zips: set CDF_ZIPS (folder of the zips), and optionally
// SPACEDEMO_GAME_DIR (a Half-Life folder with cstrike\maps) and CDF_POOL (an old-map folder).
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const shots = join(root, 'out', 'screenshots');
const zips = process.env.CDF_ZIPS;
const pool = process.env.CDF_POOL;
const dataDir = mkdtempSync(join(tmpdir(), 'spacedemo-lib-e2e-'));

let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    executablePath: (await import('electron')).default as unknown as string,
    env: { ...process.env, SPACEDEMO_USER_DATA: dataDir },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForSelector('[data-testid="page-library"]');
}

async function shot(name: string): Promise<void> {
  if (process.env.SPACEDEMO_SHOTS === '0') return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const rows = () => page.locator('[data-testid="demo-row"]');
const waitScanDone = () => page.waitForFunction(() => !document.querySelector('[data-testid="library-progress"]') && document.querySelectorAll('[data-testid="demo-row"][data-status="waiting"]').length === 0, undefined, { timeout: 240_000 });

describe.skipIf(!zips)('library screen', () => {
  beforeAll(launch);
  afterAll(async () => { await app?.close(); });

  it('starts empty with an Add folder button', async () => {
    expect(await page.textContent('[data-testid="library-summary"]')).toBe('No demo folders added yet.');
    await shot('6 library empty');
  });

  it('adds the map pool in Settings', async () => {
    if (!pool) return;
    await page.click('nav button:has-text("Settings")');
    await page.evaluate((p) => window.spacedemo.addMapFolder(p), pool);
    await page.click('nav button:has-text("Fix & convert")');
    await page.click('nav button:has-text("Settings")');
    await page.waitForSelector(`[data-testid="settings-maps"] li:has-text("${pool.replace(/\\/g, '\\\\')}")`);
    await page.click('nav button:has-text("Library")');
  });

  it('reads all 27 demos from the zips, with progress', async () => {
    // Same path a dropped folder takes (drag-and-drop gives the window file paths, then this call).
    await page.evaluate((p) => window.spacedemo.addToLibrary([p]), zips!);
    await page.waitForSelector('[data-testid="library-progress"], [data-testid="demo-row"]');
    await shot('7 library reading');
    await waitScanDone();
    expect(await rows().count()).toBe(27);
    expect(await page.textContent('[data-testid="library-summary"]')).toBe('27 demos in 1 folder');
    expect(await page.locator('[data-testid="demo-row"][data-status="needs-fix"]').count()).toBe(27);
    const settings = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
    expect(settings.libraryFolders).toEqual([zips]);
    await shot('8 library (27 demos)');
  });

  it('shows real dates, lengths and voice, newest first', async () => {
    const first = rows().first();
    expect(await first.locator('.demo-name').textContent()).toBe('NTAtside(broken)');
    expect(await first.textContent()).toContain('13 Apr 2003');
    const mod = rows().filter({ hasText: 'modTside' });
    const t = await mod.textContent();
    expect(t).toContain('6 Oct 2002');
    expect(t).toContain('de_train');
    expect(t).toContain('Delusional Tx CS Priv');
    expect(t).toContain('7.7 min');
    expect(t).toContain('Old · p46');
    expect(t).toContain('Needs fixing');
  });

  it('searches by player and filters by map and voice', async () => {
    await page.fill('#search', 'Healthy-Poison');
    await expect.poll(() => rows().count()).toBeLessThan(27);
    const names = await rows().locator('.demo-name').allTextContents();
    expect(names).toContain('modTside');
    expect(names.every((n) => /mod/i.test(n))).toBe(true);
    await page.fill('#search', '');

    await page.selectOption('#mapfilter', 'de_nuke');
    expect(await rows().count()).toBe(4);
    await page.selectOption('#mapfilter', '');

    await page.click('button.filter-chip:has-text("With voice")');
    expect(await rows().count()).toBe(25);
    await page.click('button.filter-chip:has-text("All")');
    expect(await rows().count()).toBe(27);
  });

  it('sorts by length', async () => {
    await page.click('button[aria-label="Sort by length"]');
    expect(await rows().first().locator('.demo-name').textContent()).toBe('MoD train T hltvdemo');
    await page.click('button[aria-label="Sort by length"]');
    expect(await rows().first().locator('.demo-name').textContent()).toBe('MoD train');
  });

  it('checks maps against the game and the map pool', async () => {
    if (!pool || !process.env.SPACEDEMO_GAME_DIR) return;
    const notes = await rows().locator('.sub[class*="map-"]').allTextContents();
    expect(notes.filter((n) => n.includes('map missing') || n.includes('different version'))).toEqual([]);
    expect(await rows().filter({ hasText: 'forsakenTside' }).textContent()).toContain('old version · map pool');
    expect(await rows().filter({ hasText: 'modTside' }).textContent()).toContain('installed');
  });

  it('opens instantly from the cache after a restart', async () => {
    await app.close();
    await launch();
    await page.waitForSelector('[data-testid="demo-row"]');
    expect(await page.locator('[data-testid="demo-row"][data-status="waiting"]').count()).toBe(0);
    expect(await rows().count()).toBe(27);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await shot('9 library (light)');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  });

  it('removes a folder from the library (files untouched)', async () => {
    await page.click(`button[aria-label="Remove ${zips} from the library"]`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="demo-row"]').length === 0);
    expect(await page.textContent('[data-testid="library-summary"]')).toBe('No demo folders added yet.');
  });
});
