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
const outDir = mkdtempSync(join(tmpdir(), 'spacedemo-fixed-'));

let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    executablePath: (await import('electron')).default as unknown as string,
    // DRY_LAUNCH: Steam is never started; what would run goes to launch-log.txt.
    env: { ...process.env, SPACEDEMO_USER_DATA: dataDir, SPACEDEMO_DRY_LAUNCH: '1', SPACEDEMO_OUTPUT_DIR: outDir },
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

  it('opens a demo\'s details page (4.4) and goes back', async () => {
    await page.fill('#search', '');
    await page.click('[data-testid="demo-row"] button.name-btn:text-is("modTside")');
    await page.waitForSelector('[data-testid="details-score"]', { timeout: 60_000 });
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Library › modTside');
    const score = await page.textContent('[data-testid="details-score"]');
    expect(score).toContain('6 : 6');
    expect(score).toContain("Matches the server's own score");
    expect(await page.locator('.rounds li').count()).toBe(12);
    const players = await page.textContent('[data-testid="details-players"]');
    expect(players).toContain(':i69:Endbringer');
    expect(players).toContain('own voice not recorded');
    expect(players).toContain('not heard');
    expect(await page.textContent('[data-testid="details-talk"]')).toContain(':i69:Virus23');
    expect(await page.locator('.chat li').count()).toBe(8);
    await page.click('[data-testid="details-chat"] button:has-text("Show all")');
    expect(await page.locator('.chat li').count()).toBeGreaterThan(8);
    await page.click('[data-testid="details-chat"] button:has-text("Show fewer")');
    if (process.env.SPACEDEMO_GAME_DIR) {
      expect(await page.locator('.overview img').count()).toBe(1);
      expect(await page.locator('.overview .site-letter').allTextContents()).toEqual(['A', 'B']);
    }
    await shot('10 details modTside');
    // Phase 5 tabs: server card (5.h), rounds (5.c), scoreboard (5.d).
    expect(await page.textContent('[data-testid="details-server"]')).toContain('CAL config file has been executed');
    expect(await page.locator('[data-testid="details-network"] tbody tr').count()).toBeGreaterThanOrEqual(10);
    await page.click('[role="tab"]:has-text("Rounds")');
    expect(await page.locator('[data-testid="round-line"]').count()).toBe(12);
    expect(await page.locator('[data-testid="round-line"]').first().textContent()).toContain('bomb defused');
    await shot('10b details rounds');
    await page.click('[role="tab"]:has-text("Scoreboard")');
    expect(await page.locator('[data-testid="stat-row"]').count()).toBe(10);
    expect(await page.locator('[data-testid="stat-row"]').first().textContent()).toContain(':i69:Endbringer');
    await shot('10c details scoreboard');
    // 5.l chat and radio log.
    await page.click('[role="tab"]:has-text("Chat & radio")');
    await page.waitForSelector('[data-testid="details-log"]');
    expect(await page.textContent('[data-testid="log-count"]')).toBe('45 of 143 shown');
    expect(await page.locator('[data-testid="details-log"] h3').first().textContent()).toContain('Warm-up');
    await page.click('button.filter-chip:has-text("Automatic radio")');
    expect(await page.textContent('[data-testid="log-count"]')).toBe('143 of 143 shown');
    await page.fill('input[aria-label="Search messages"]', 'gl hf');
    expect(await page.locator('[data-testid="log-row"]').count()).toBeGreaterThanOrEqual(2);
    await page.fill('input[aria-label="Search messages"]', '');
    await page.click('button.filter-chip:has-text("Automatic radio")');
    await page.selectOption('select[aria-label="Player"]', ':i69:Guido');
    await page.click('[data-testid="log-row"] .log-time >> nth=0');
    expect(await page.textContent('[data-testid="log-picked"]')).toContain('in the demo');
    await page.selectOption('select[aria-label="Player"]', '');
    expect(await page.locator('[data-testid="radio-row"]').first().textContent()).toContain(':i69:Guido');
    await shot('10d details chat and radio');
    // 5.m voice timeline.
    await page.click('[role="tab"]:has-text("Voice")');
    await page.waitForSelector('[data-testid="details-voice"]');
    expect(await page.locator('[data-testid="voice-row"]').count()).toBe(4);
    expect(await page.locator('[data-testid="voice-row"]').first().textContent()).toContain(':i69:Virus23');
    expect(await page.locator('.vt-burst').count()).toBe(332);
    await shot('10e details voice whole demo');
    await page.click('[data-testid="details-voice"] button.filter-chip:text-is("R3")');
    expect(await page.textContent('[data-testid="details-voice"]')).toContain('Round 3');
    await page.locator('.vt-burst').first().click();
    expect(await page.textContent('[data-testid="voice-picked"]')).toContain('round 3');
    await shot('10f details voice round 3');
    // 5.k heatmaps.
    await page.click('[role="tab"]:has-text("Heatmaps")');
    await page.waitForSelector('[data-testid="details-heatmap"]');
    expect(await page.locator('[data-testid="heat-kill"]').count()).toBeGreaterThan(60);
    expect(await page.locator('[data-testid="heat-plant"]').count()).toBe(10);
    if (process.env.SPACEDEMO_GAME_DIR) expect(await page.textContent('[data-testid="heat-plants"]')).toContain('Site A: 4 · Site B: 6');
    expect(await page.textContent('[data-testid="heat-distances"]')).toContain('median');
    await page.click('button.filter-chip:has-text("Time spent")');
    await page.waitForSelector('[data-testid="heat-time"]');
    await shot('10g details heatmaps');
    await page.selectOption('select[aria-label="Round"]', '1');
    await page.selectOption('select[aria-label="Player"]', ':i69:Endbringer');
    expect(await page.locator('[data-testid="heat-plant"]').count()).toBe(1);
    await page.locator('[data-testid="heat-kill"]').first().click({ force: true });
    expect(await page.textContent('[data-testid="heat-picked"]')).toContain(':i69:Endbringer →');
    await shot('10h details heatmaps round 1 Endbringer');
    // 5.j radar replay.
    await page.click('[role="tab"]:has-text("Radar replay")');
    await page.waitForSelector('[data-testid="replay-svg"]', { timeout: 30_000 });
    expect(await page.textContent('[data-testid="replay-clock"]')).toContain('freeze time');
    expect(await page.locator('[data-testid="replay-players"] li').count()).toBe(10);
    // Go to just before the first kill of round 1 through the events list, then play a little.
    await page.locator('[data-testid="replay-events"] button.log-time').first().click();
    expect(await page.locator('[data-testid="replay-dot"][data-source="seen"]').count()).toBeGreaterThanOrEqual(3);
    await page.click('[data-testid="replay-play"]');
    await page.waitForTimeout(3500);
    await page.click('[data-testid="replay-play"]');
    expect(await page.locator('[data-testid="replay-dot"][data-source="dead"]').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('[data-testid="replay-feed"] li').count()).toBeGreaterThanOrEqual(1);
    await page.locator('[data-testid="replay-svg"]').scrollIntoViewIfNeeded();
    await shot('10i details radar replay');
    await page.selectOption('[data-testid="details-replay"] select[aria-label="Round"]', '5');
    await page.waitForFunction(() => document.querySelector('[data-testid="replay-clock"]')?.textContent?.includes('freeze time'));
    await page.fill('[data-testid="replay-slider"]', String(await page.$eval('[data-testid="replay-slider"]', (e) => (Number((e as HTMLInputElement).min) + 70))));
    expect(await page.locator('[data-testid="replay-bomb"]').count()).toBeLessThanOrEqual(1);
    // The bomb carrier (Virus23 has the C4 until he plants at 12:37).
    expect(await page.locator('[data-testid="replay-carrier"]').count()).toBe(1);
    expect(await page.textContent('[data-testid="replay-players"]')).toContain('has the bomb');
    if (process.env.SPACEDEMO_GAME_DIR) {
      // Estimated positions (2.16): the enemies the recorder can't see are drawn as estimates; switch off → none.
      expect(await page.locator('[data-testid="replay-dot"][data-source="estimated"]').count()).toBeGreaterThanOrEqual(1);
      expect(await page.locator('.est-area .uncertainty').count()).toBeGreaterThanOrEqual(1);
      await page.click('[data-testid="replay-est"]');
      expect(await page.locator('[data-testid="replay-dot"][data-source="estimated"]').count()).toBe(0);
      await page.click('[data-testid="replay-est"]');
    }
    await page.locator('[data-testid="replay-svg"]').scrollIntoViewIfNeeded();
    await shot('10j details radar replay round 5');
    // 5.q enemy sightings (POV).
    await page.click('[role="tab"]:has-text("Sightings")');
    await page.waitForSelector('[data-testid="details-sightings"]');
    expect(await page.textContent('[data-testid="sight-first"]')).toContain('First contact');
    expect(await page.locator('[data-testid="sight-row"]').count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator('[data-testid="sight-summary"] tbody tr').count()).toBe(5);
    await page.click('[data-testid="details-sightings"] button.filter-chip:text-is("R3")');
    expect(await page.textContent('[data-testid="sight-first"]')).toContain('heard');
    await shot('10k details sightings round 3');
    await page.click('[role="tab"]:has-text("Overview")');
    await page.click('.back-link');
    await page.waitForSelector('[data-testid="demo-table"]');

    // An old map version: no picture, a plain note instead.
    await page.click('[data-testid="demo-row"] button.name-btn:text-is("mfaTside")');
    await page.waitForSelector('[data-testid="details-map"]', { timeout: 60_000 });
    if (process.env.CDF_POOL) expect(await page.textContent('[data-testid="details-map"]')).toContain("today's overview picture doesn't match");
    if (process.env.CDF_POOL) {
      await page.click('[role="tab"]:has-text("Heatmaps")');
      await page.waitForSelector('[data-testid="details-heatmap"]');
      expect(await page.locator('.heat-floor').count()).toBe(1);
      expect(await page.textContent('[data-testid="details-heatmap"]')).toContain('drawn from the map file');
      await shot('11b heatmaps mfaTside (map drawn from the file)');
    }
    await shot('11 details mfaTside (old map)');
    await page.click('nav button:has-text("Library")');
    await page.waitForSelector('[data-testid="demo-table"]');
  });

  it('watches a demo: fix first, then start the game (4.5)', async () => {
    if (!process.env.SPACEDEMO_GAME_DIR) return;
    await page.click('button[aria-label="Watch modTside"]');
    await page.waitForSelector('[data-testid="watch-guide"]');
    expect(await page.textContent('[data-testid="watch-fix-note"]')).toContain('modTside_fixed.dem');
    expect(await page.textContent('[data-testid="watch-guide"]')).toContain('viewdemo');
    expect(await page.locator('[data-testid="watch-dialog"] input[name="speed"]:disabled').count()).toBe(4);
    await shot('12 watch dialog');
    await page.click('[data-testid="watch-start"]');
    await page.waitForSelector('[data-testid="watch-progress"][data-stage="playing"]', { timeout: 240_000 });
    const text = await page.textContent('[data-testid="watch-progress"]');
    expect(text).toContain('Converted protocol 46 → 48');
    expect(text).toContain('Open the console (~)');
    await shot('13 watch playing');
    const log = readFileSync(join(dataDir, 'launch-log.txt'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log[0].args).toEqual(['-applaunch', '10', '-insecure', '+viewdemo', 'cdf_test/modTside_fixed']);
    await page.click('[data-testid="watch-progress"] button:has-text("Done")');
    expect(await page.locator('[data-testid="watch-dialog"]').count()).toBe(0);
    // The library now knows the fixed copy.
    const row = page.locator('[data-testid="demo-row"]').filter({ hasText: 'modTside' }).filter({ hasNotText: 'CTside' });
    expect(await row.getAttribute('data-status')).toBe('fixed');
    expect(await row.textContent()).toContain('Fixed · ready');
    // Watching again: no fixing.
    await page.click('button[aria-label="Watch modTside"]');
    await page.waitForSelector('[data-testid="watch-guide"]');
    expect(await page.locator('[data-testid="watch-fix-note"]').count()).toBe(0);
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-testid="watch-dialog"]').count()).toBe(0);
  });

  it('fixes everything that needs it from the library, with results (4.6)', async () => {
    if (!process.env.SPACEDEMO_GAME_DIR) return;
    const n = Number((await page.textContent('[data-testid="library-fix-all"]'))!.match(/\d+/)![0]);
    expect(n).toBe(26); // modTside was fixed by the Watch test
    await page.click('[data-testid="library-fix-all"]');
    await page.waitForSelector('[data-testid="fixpage"]');
    expect(await page.textContent('[data-testid="titlebar-page"]')).toBe('Fix & convert');
    await page.waitForSelector('[data-testid="fix-row"][data-state="fixing"], [data-testid="fix-row"][data-state="fixed"]');
    await shot('14 fix running');
    await page.waitForFunction(() => /\d+ of \d+ demos fixed/.test(document.querySelector('[data-testid="fix-summary"]')?.textContent ?? ''), undefined, { timeout: 600_000 });
    expect(await page.textContent('[data-testid="fix-summary"]')).toContain('26 of 26 demos fixed');
    expect(await page.locator('[data-testid="fix-row"][data-state="fixed"]').count()).toBe(26);
    await shot('15 fix results');
    await page.click('nav button:has-text("Library")');
    await page.waitForSelector('[data-testid="demo-table"]');
    expect(await page.locator('[data-testid="demo-row"][data-status="fixed"]').count()).toBe(27);
    expect(await page.locator('[data-testid="library-fix-all"]').count()).toBe(0);
  });

  it('opens instantly from the cache after a restart', async () => {
    await app.close();
    await launch();
    await page.waitForSelector('[data-testid="demo-row"]');
    expect(await page.locator('[data-testid="demo-row"][data-status="waiting"]').count()).toBe(0);
    expect(await rows().count()).toBe(27);
    if (process.env.SPACEDEMO_GAME_DIR) expect(await page.locator('[data-testid="demo-row"][data-status="fixed"]').count()).toBe(27);
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
