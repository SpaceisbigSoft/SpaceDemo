// 6.7: update checks against GitHub releases, with a stand-in for electron-updater.
import { describe, expect, it } from 'vitest';
import { compareVersions, isPrerelease, plainNotes, UpdateService, type UpdaterLike } from '../main/updates.js';
import type { UpdateState } from '../shared/api.js';

function fakeUpdater(latest: string | null, opts: { fail?: Error; failDownload?: Error } = {}) {
  const calls: string[] = [];
  let progress: ((p: { percent: number }) => void) | undefined;
  const u: UpdaterLike & { calls: string[] } = {
    autoDownload: true, autoInstallOnAppQuit: false, allowPrerelease: false, calls,
    async checkForUpdates() {
      calls.push('check');
      if (opts.fail) throw opts.fail;
      return latest ? { updateInfo: { version: latest, releaseNotes: '<p>Fixed <b>voice</b> &amp; maps</p><ul><li>One</li><li>Two</li></ul>' } } : null;
    },
    async downloadUpdate() {
      calls.push('download');
      progress?.({ percent: 41.6 });
      if (opts.failDownload) throw opts.failDownload;
      return [];
    },
    quitAndInstall(silent, run) { calls.push(`install:${silent}:${run}`); },
    on(_e, l) { progress = l; return u; },
  };
  return u;
}

function service(current: string, u: UpdaterLike, supported = true) {
  const seen: UpdateState[] = [];
  const s = new UpdateService({ current, supported, updater: async () => u, onChange: (x) => seen.push(x), now: () => 1000 });
  return { s, seen };
}

describe('versions', () => {
  it('orders versions like GitHub releases', () => {
    expect(compareVersions('0.9.0', '0.8.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.9.0-beta.2')).toBe(1);
    expect(compareVersions('0.9.0-beta.2', '0.9.0-beta.10')).toBe(-1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(isPrerelease('0.9.0-beta.2')).toBe(true);
    expect(isPrerelease('0.9.0')).toBe(false);
  });

  it('turns GitHub release notes into plain text', () => {
    expect(plainNotes('<p>Fixed <b>voice</b> &amp; maps</p><ul><li>One</li><li>Two</li></ul>')).toBe('Fixed voice & maps\n• One\n• Two');
    expect(plainNotes([{ version: '1', note: 'A' }, { version: '2', note: 'B' }])).toBe('Version 2\nB\n\nVersion 1\nA');
    expect(plainNotes(undefined)).toBeUndefined();
  });

  it('lists every release since the installed one, newest first, in one list (owner, 2026-11-02)', () => {
    const feed = [
      { version: '0.9.0', note: '<p>Older</p><ul><li>Already installed</li></ul>' },
      { version: '0.9.1-beta.1', note: '<ul><li>Beta preview of voice</li></ul>' },
      { version: '0.9.1', note: '<h3>Added</h3><ul><li>Voice</li><li>Maps</li></ul>' },
      { version: '0.9.2', note: '<h3>Added</h3><ul><li>Betas</li><li>Maps</li></ul>' },
      { version: '0.9.3', note: '<ul><li>Not out for this check</li></ul>' },
    ];
    // Normal version: every normal release in between, betas skipped, "Maps" only once, headings kept.
    expect(plainNotes(feed, { current: '0.9.0', latest: '0.9.2' })).toBe(
      'Version 0.9.2\nAdded\n• Betas\n• Maps\n\nVersion 0.9.1\nAdded\n• Voice');
    // On a beta: the betas in between are listed too.
    expect(plainNotes(feed, { current: '0.9.0-beta.3', latest: '0.9.1' })).toBe(
      'Version 0.9.1\nAdded\n• Voice\n• Maps\n\nVersion 0.9.1-beta.1\n• Beta preview of voice\n\nVersion 0.9.0\nOlder\n• Already installed');
    // A single release in range: no version heading.
    expect(plainNotes(feed, { current: '0.9.1', latest: '0.9.2' })).toBe('Added\n• Betas\n• Maps');
  });
});

describe('UpdateService (6.7)', () => {
  it('does nothing outside the installed app', async () => {
    const u = fakeUpdater('9.9.9');
    const { s } = service('0.9.0', u, false);
    expect((await s.check()).stage).toBe('unsupported');
    expect(u.calls).toEqual([]);
  });

  it('says when the newest version is installed', async () => {
    const u = fakeUpdater('0.9.0-beta.2');
    const { s } = service('0.9.0-beta.2', u);
    expect(await s.check()).toMatchObject({ stage: 'none', checked: 1000 });
    expect(u.autoDownload).toBe(false);
    expect(u.allowPrerelease).toBe(true); // a beta is offered newer betas
    expect(u.fullChangelog).toBe(true); // notes of every release since the installed one
  });

  it('offers, downloads and installs a newer version, only when asked', async () => {
    const u = fakeUpdater('0.9.1');
    const { s, seen } = service('0.9.0', u);
    expect(await s.check()).toMatchObject({ stage: 'available', latest: '0.9.1', notes: 'Fixed voice & maps\n• One\n• Two' });
    expect(u.allowPrerelease).toBe(false); // normal versions only get normal versions
    expect(u.autoInstallOnAppQuit).toBe(true);
    expect(u.calls).toEqual(['check']);
    expect((await s.download()).stage).toBe('ready');
    expect(seen.some((x) => x.stage === 'downloading' && x.percent === 42)).toBe(true);
    await s.install();
    expect(u.calls).toEqual(['check', 'download', 'install:true:true']);
  });

  it('reports problems in plain words and lets the person try again', async () => {
    const offline = service('0.9.0', fakeUpdater(null, { fail: new Error('getaddrinfo ENOTFOUND github.com') })).s;
    expect(await offline.check(true)).toMatchObject({ stage: 'error', manual: true, error: expect.stringContaining("Couldn't reach GitHub") });
    const u = fakeUpdater('0.9.1', { failDownload: new Error('HttpError: 404') });
    const { s } = service('0.9.0', u);
    await s.check();
    expect(await s.download()).toMatchObject({ stage: 'error', latest: '0.9.1' });
    expect((await s.install(), u.calls)).not.toContain('install:true:true');
  });
});
