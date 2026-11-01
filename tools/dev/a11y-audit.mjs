// 4.8 accessibility audit of the real SpaceDemo window (dev tool, not part of the app).
//   xvfb-run -a node tools/dev/a11y-audit.mjs <out folder> <axe.min.js> <demo folder> [<old maps folder>]
// axe-core (npm, MPL-2.0) is not a dependency: install it in a scratch folder (npm install axe-core@4.13.0) and pass its axe.min.js.
// Runs WCAG 2.1 A/AA checks on Library, Details (all tabs), Fix & convert, Players, Settings, Help (6.3) and the Watch dialog, in dark and
// light, at 1280x820 (100 %) and 853x547 (1280x820 at 150 %); tabs through pages checking a visible focus ring; checks Escape
// closes the Watch dialog and that no page scrolls sideways. Writes results.json + screenshots. v46: 0 problems after fixes.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const root = process.cwd(), out = process.argv[2], axePath = process.argv[3];
const app = await electron.launch({ args: [root, '--no-sandbox'], executablePath: (await import(root + '/node_modules/electron/index.js')).default,
  env: { ...process.env, SPACEDEMO_USER_DATA: mkdtempSync(join(tmpdir(), 'sd-')), SPACEDEMO_DRY_LAUNCH: '1' } });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1280, height: 820 });
await page.waitForSelector('[data-testid="page-library"]');
await page.evaluate((p) => window.spacedemo.addToLibrary([p]), process.argv[4]);
if (process.argv[5]) await page.evaluate((p) => window.spacedemo.addMapFolder(p), process.argv[5]);
await page.waitForFunction(() => document.querySelectorAll('[data-testid="demo-row"]').length >= 8 && !document.querySelector('[data-testid="library-progress"]'), undefined, { timeout: 240000 });
const results = [];
async function audit(name) {
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(readFileSync(axePath, 'utf8') + '\n;0');
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, eg: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n').slice(1, 2).join(' ')) }));
  });
  const overflow = await page.evaluate(() => { const p = document.querySelector('.page'); return p ? p.scrollWidth - p.clientWidth : 0; });
  results.push({ name, violations: r, overflowX: overflow });
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function keyboard(name, max = 60) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const seen = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
      return { tag: e.tagName.toLowerCase(), label: (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().slice(0, 40), visible, onScreen: r.width > 0 && r.height > 0 };
    });
    seen.push(f);
  }
  const bad = seen.filter((f) => f && (!f.visible || !f.onScreen));
  results.push({ name: name + ' (keyboard)', tabStops: seen.filter(Boolean).length, noFocusRing: [...new Set(bad.map((b) => `${b.tag}:${b.label}`))].slice(0, 12), lostFocus: seen.filter((x) => !x).length });
}
const nav = (t) => page.click(`nav button:has-text("${t}")`);
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => window.spacedemo.setTheme(t), theme);
  for (const [w, h, sz] of [[1280, 820, '100'], [853, 547, '150']]) {
    await page.setViewportSize({ width: w, height: h });
    const tag = `${theme}-${sz}`;
    await nav('Library'); await audit(`library-${tag}`);
    if (sz === '100') await keyboard(`library-${tag}`);
    await page.click('button.demo-name:has-text("' + (process.env.A11Y_DEMO ?? 'mfaTside') + '")');
    await page.waitForSelector('[data-testid="details-score"]', { timeout: 120000 });
    await audit(`details-overview-${tag}`);
    const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => e.id));
    if (sz === '100' && theme === 'dark') {
      for (const id of tabs.slice(1)) { await page.click(`#${id}`); await page.waitForTimeout(1500); await audit(`details-${id}-${tag}`); }
      await page.click(`#${tabs[0]}`);
      await keyboard(`details-${tag}`);
    }
    await nav('Fix & convert'); await audit(`fix-${tag}`);
    await nav('Players'); await page.waitForTimeout(3000); await audit(`players-${tag}`);
    await nav('Settings'); await audit(`settings-${tag}`);
    if (sz === '100') await keyboard(`settings-${tag}`);
    await nav('Help'); await audit(`help-${tag}`);
    if (sz === '100') await keyboard(`help-${tag}`);
    await nav('Library');
    await page.click('button[aria-label="Watch ' + (process.env.A11Y_DEMO ?? 'mfaTside') + '"]'); await page.waitForTimeout(800); await audit(`watch-dialog-${tag}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const stillOpen = await page.$('[role="dialog"]');
    results.push({ name: `watch-dialog-${tag} Escape closes`, ok: !stillOpen });
    if (stillOpen) await page.click('[role="dialog"] button:has-text("Cancel")').catch(() => {});
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
await app.close();
