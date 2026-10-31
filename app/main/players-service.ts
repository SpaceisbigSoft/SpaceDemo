// 5.p Players page: reads every library demo's players once (in the background thread), keeps them in a cache file,
// and builds the totals with the owner's merges. Only reads demos.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DemoPlayers, PlayersView } from '../shared/api.js';
import type { LibraryService } from './library-service.js';
import { playerTotals } from './players.js';
import type { LibraryReader } from './reader.js';

/** Bump when DemoPlayers changes shape, so old cache entries are read again. */
const CACHE_VERSION = 1;

export interface PlayersServiceOptions {
  library: LibraryService;
  reader: LibraryReader;
  cacheFile: string;
  merges: () => Record<string, string>;
  rejected: () => string[];
  onChange?: (view: PlayersView) => void;
}

interface Entry { v: number; size: number; mtime: number; data: DemoPlayers | null }

export class PlayersService {
  private cache = new Map<string, Entry>();
  private progress: { done: number; total: number } | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly o: PlayersServiceOptions) {
    try {
      const raw = JSON.parse(readFileSync(o.cacheFile, 'utf8')) as Record<string, Entry>;
      for (const [k, e] of Object.entries(raw)) if (e?.v === CACHE_VERSION) this.cache.set(k, e);
    } catch { /* no cache yet */ }
  }

  /** The totals from what is read so far; starts reading the rest in the background. */
  view(): PlayersView {
    void this.update();
    return this.build();
  }

  /** Reads demos that aren't in the cache (one at a time). Resolves when done (tests). */
  update(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }

  private build(): PlayersView {
    const rows = this.o.library.state().demos;
    const demos: DemoPlayers[] = [];
    for (const d of rows) {
      const e = this.cache.get(d.key);
      if (e?.data && e.size === d.size) demos.push({ ...e.data, date: d.date, name: d.name, map: d.info?.map ?? e.data.map });
    }
    return { ...playerTotals(demos, this.o.merges(), this.o.rejected()), progress: this.progress };
  }

  private async run(): Promise<void> {
    const rows = this.o.library.state().demos.filter((d) => d.info && d.info.gameDir.toLowerCase() === 'cstrike');
    const todo = rows.filter((d) => { const e = this.cache.get(d.key); return !e || e.size !== d.size; });
    if (!todo.length) return;
    this.progress = { done: 0, total: todo.length };
    this.o.onChange?.(this.build());
    for (const d of todo) {
      const row = this.o.library.row(d.key);
      if (!row) continue;
      const res = await this.o.reader.players({ key: d.key, file: row.candidate.file, zipEntry: row.candidate.zipEntry, name: d.name, date: d.date, map: d.info?.map ?? '' });
      this.cache.set(d.key, { v: CACHE_VERSION, size: d.size, mtime: row.candidate.mtime, data: 'error' in res ? null : res });
      this.progress = { done: this.progress.done + 1, total: this.progress.total };
      this.o.onChange?.(this.build());
    }
    this.progress = undefined;
    // Forget demos no longer in the library, then save.
    const live = new Set(this.o.library.state().demos.map((d) => d.key));
    for (const k of [...this.cache.keys()]) if (!live.has(k)) this.cache.delete(k);
    try {
      mkdirSync(dirname(this.o.cacheFile), { recursive: true });
      writeFileSync(`${this.o.cacheFile}.tmp`, JSON.stringify(Object.fromEntries(this.cache)));
      renameSync(`${this.o.cacheFile}.tmp`, this.o.cacheFile);
    } catch { /* the cache is only a speed-up */ }
    this.o.onChange?.(this.build());
  }

  /** After merges change. */
  refresh(): PlayersView {
    const v = this.build();
    this.o.onChange?.(v);
    return v;
  }
}
