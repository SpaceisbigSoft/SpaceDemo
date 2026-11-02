// 4.10: the per-demo AI voice checkbox next to Fix. Needs CDF_LAB: a folder with a demo that has voice
// (CS 1.3+, e.g. the Old CS Lab's cs13_test1.dem) and one without (cs10_test1.dem).
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const shots = join(root, 'out', 'screenshots');
const lab = process.env.CDF_LAB;
const dataDir = mkdtempSync(join(tmpdir(), 'spacedemo-ai-e2e-'));
let app: ElectronApplication;
let page: Page;

/** A stand-in model file that passes the app's quick check (.onnx, 10 MB+, ONNX's first byte); never run. */
function fakeModel(): string {
  const f = join(dataDir, 'fake-model.onnx');
  const fd = openSync(f, 'w');
  writeSync(fd, Buffer.alloc(10_000_001, 0), 0, 10_000_001);
  writeSync(fd, Buffer.from([0x08]), 0, 1, 0);
  closeSync(fd);
  return f;
}

const row = (name: string) => page.locator('[data-testid="demo-row"]', { hasText: name });
const settings = () => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));

describe.skipIf(!lab)('AI voice per demo (4.10)', () => {
  beforeAll(async () => {
    app = await electron.launch({
      args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
      executablePath: (await import('electron')).default as unknown as string,
      env: { ...process.env, SPACEDEMO_USER_DATA: dataDir, SPACEDEMO_DRY_LAUNCH: '1', SPACEDEMO_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'spacedemo-fixed-')) },
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForSelector('[data-testid="page-library"]');
    await page.evaluate((p) => window.spacedemo.addToLibrary([p]), lab!);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="demo-row"]').length > 0 && document.querySelectorAll('[data-testid="demo-row"][data-status="waiting"]').length === 0, undefined, { timeout: 120_000 });
  }, 180_000);
  afterAll(async () => { await app?.close(); });

  it('is greyed out until the AI model is there, and for demos without voice', async () => {
    const box = row('cs13_test1').locator('[data-testid="demo-ai-voice"] input');
    expect(await box.isDisabled()).toBe(true);
    // Every row has the box; a demo without voice can't be ticked (and says why).
    const none = row('cs10_test1').locator('[data-testid="demo-ai-voice"]');
    expect(await none.locator('input').isDisabled()).toBe(true);
    expect(await none.getAttribute('title')).toContain('No voice');
  });

  it('ticks AI voice for one demo only; Settings stays off', async () => {
    await page.evaluate((p) => window.spacedemo.chooseAiModel(p), fakeModel());
    const box = row('cs13_test1').locator('[data-testid="demo-ai-voice"] input');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="demo-ai-voice"] input')].some((i) => !i.hasAttribute('disabled')));
    expect(await box.isChecked()).toBe(false);
    await box.check();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('[data-testid="demo-ai-voice"] input')].some((i) => i.checked));
    const s = settings();
    expect(s.aiVoice).toBe(false);
    expect(Object.values(s.aiVoiceDemos)).toEqual([true]);
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, '4.10 library AI voice per demo.png') });
    // The same choice on the details page.
    await row('cs13_test1').locator('.demo-name').click();
    await page.waitForSelector('[data-testid="details-watch"]');
    expect(await page.isChecked('[data-testid="demo-ai-voice"] input')).toBe(true);
    await page.screenshot({ path: join(shots, '4.10 details AI voice.png') });
  });

  it('unticking goes back to following Settings (nothing stored)', async () => {
    await page.uncheck('[data-testid="demo-ai-voice"] input');
    await page.waitForFunction(() => (document.querySelector('[data-testid="demo-ai-voice"] input') as HTMLInputElement | null)?.checked === false);
    expect(settings().aiVoiceDemos).toEqual({});
  });
});
