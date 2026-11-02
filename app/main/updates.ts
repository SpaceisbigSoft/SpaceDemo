// Plan 6.7: updates from SpaceDemo's GitHub releases (electron-updater). On start (unless switched off in Settings)
// SpaceDemo asks GitHub for the newest *published* release; if it's newer, the window offers it. Nothing downloads
// until the person says so; then only the changed parts are downloaded (blockmap), and "Restart now" (or simply closing
// SpaceDemo) runs the new installer silently over the old one: settings, library and fixed demos stay.
// People on a beta (version with "-", e.g. 0.9.0-beta.2) are also offered newer betas; others only normal versions.
import type { UpdateState } from '../shared/api.js';

/** The part of electron-updater's autoUpdater we use (a fake one in the tests). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  /** True: releaseNotes lists every release between the installed version and the newest one ({ version, note }[]). */
  fullChangelog?: boolean;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo: { version: string; releaseName?: string | null; releaseNotes?: unknown } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (p: { percent: number }) => void): unknown;
}

/** "0.9.0-beta.2" → [0, 9, 0] + ['beta', 2]. */
function parse(v: string): { nums: number[]; pre: (string | number)[] } {
  const [main, ...rest] = v.replace(/^v/, '').split('-');
  const nums = main.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pre = rest.join('-').split('.').filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  return { nums, pre };
}

/** Semantic-version order: 1 if a is newer than b, -1 if older, 0 if the same (1.0.0-beta.2 < 1.0.0). */
export function compareVersions(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return Math.sign(p - q);
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const isPrerelease = (v: string): boolean => v.replace(/^v/, '').includes('-');

/** One release's notes (GitHub HTML) as plain text. */
function noteText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Release notes as plain text. GitHub gives one release's HTML, or (fullChangelog) a list with every release between
 * the installed version and the newest one (owner, 2026-11-02: an update shows everything that changed since the
 * installed version, in one list, even when several releases came out in between). The list is newest first, one
 * section per version; people on a normal version skip the betas in between (the normal release's notes cover them);
 * a line already shown under a newer version isn't repeated.
 */
export function plainNotes(notes: unknown, range?: { current: string; latest: string }): string | undefined {
  if (typeof notes === 'string') {
    const t = noteText(notes);
    return t ? t.slice(0, 4000) : undefined;
  }
  if (!Array.isArray(notes)) return undefined;
  let list = notes
    .filter((n): n is { version?: unknown; note?: unknown } => !!n && typeof n === 'object')
    .map((n) => ({ version: String(n.version ?? ''), text: noteText(String(n.note ?? '')) }));
  if (range) {
    list = list.filter((n) => !n.version || (compareVersions(n.version, range.current) > 0 && compareVersions(n.version, range.latest) <= 0));
    if (!isPrerelease(range.current)) list = list.filter((n) => !n.version || !isPrerelease(n.version) || n.version === range.latest);
  }
  list.sort((a, b) => (a.version && b.version ? compareVersions(b.version, a.version) : 0));
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const n of list) {
    // Only list items are de-duplicated (headings such as "Fixed" may repeat per version).
    const lines = n.text.split('\n').filter((l) => {
      const item = /^\s*[•*-]\s+(.*)$/.exec(l);
      if (!item) return true;
      const key = item[1].trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!lines) continue;
    sections.push(list.length > 1 && n.version ? `Version ${n.version}\n${lines}` : lines);
  }
  const text = sections.join('\n\n').trim();
  return text ? (text.length > 12000 ? `${text.slice(0, 12000)}\n…` : text) : undefined;
}

export interface UpdateServiceOptions {
  current: string;
  /** False in development and outside Windows: updates only work in the installed app. */
  supported: boolean;
  /** Loads electron-updater's autoUpdater (only when needed). */
  updater: () => Promise<UpdaterLike>;
  onChange: (s: UpdateState) => void;
  now?: () => number;
}

export class UpdateService {
  private s: UpdateState;
  private u?: Promise<UpdaterLike>;

  constructor(private o: UpdateServiceOptions) {
    this.s = { stage: o.supported ? 'idle' : 'unsupported', current: o.current };
  }

  state(): UpdateState {
    return { ...this.s };
  }

  private set(next: Partial<UpdateState> & { stage: UpdateState['stage'] }): UpdateState {
    this.s = { current: this.o.current, latest: this.s.latest, notes: this.s.notes, checked: this.s.checked, ...next };
    if (next.stage !== 'error') delete this.s.error;
    if (next.stage !== 'downloading') delete this.s.percent;
    this.o.onChange(this.state());
    return this.state();
  }

  private updater(): Promise<UpdaterLike> {
    this.u ??= this.o.updater().then((u) => {
      u.autoDownload = false;
      u.autoInstallOnAppQuit = true; // "Later" after downloading = installed when SpaceDemo closes
      u.allowPrerelease = isPrerelease(this.o.current);
      u.fullChangelog = true; // notes of every release since the installed one, not only the newest
      u.on('download-progress', (p) => { if (this.s.stage === 'downloading') this.set({ stage: 'downloading', percent: Math.round(p.percent) }); });
      return u;
    });
    this.u.catch(() => { this.u = undefined; });
    return this.u;
  }

  /** Asks GitHub for the newest release. `manual` = the person pressed "Check now". */
  async check(manual = false): Promise<UpdateState> {
    if (!this.o.supported) return this.set({ stage: 'unsupported' });
    if (this.s.stage === 'checking' || this.s.stage === 'downloading' || this.s.stage === 'ready') return this.state();
    this.set({ stage: 'checking', manual });
    try {
      const r = await (await this.updater()).checkForUpdates();
      const checked = (this.o.now ?? Date.now)();
      const latest = r?.updateInfo.version;
      if (latest && r?.isUpdateAvailable !== false && compareVersions(latest, this.o.current) > 0) {
        return this.set({ stage: 'available', latest, notes: plainNotes(r?.updateInfo.releaseNotes, { current: this.o.current, latest }), checked, manual });
      }
      return this.set({ stage: 'none', latest: undefined, notes: undefined, checked, manual });
    } catch (e) {
      return this.set({ stage: 'error', error: friendly(e), checked: (this.o.now ?? Date.now)(), manual });
    }
  }

  /** Downloads the update the last check found. */
  async download(): Promise<UpdateState> {
    if (this.s.stage !== 'available' && !(this.s.stage === 'error' && this.s.latest)) return this.state();
    this.set({ stage: 'downloading', percent: 0, manual: true });
    try {
      await (await this.updater()).downloadUpdate();
      return this.set({ stage: 'ready', manual: true });
    } catch (e) {
      return this.set({ stage: 'error', error: friendly(e), manual: true });
    }
  }

  /** Closes SpaceDemo, installs silently and starts it again. */
  async install(): Promise<void> {
    if (this.s.stage !== 'ready') return;
    (await this.updater()).quitAndInstall(true, true);
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(msg)) return "Couldn't reach GitHub (no internet connection?). Try again later.";
  if (/403|rate limit/i.test(msg)) return 'GitHub is busy right now (too many checks). Try again in an hour.';
  return `The update check didn't work: ${msg.split('\n')[0].slice(0, 200)}`;
}
