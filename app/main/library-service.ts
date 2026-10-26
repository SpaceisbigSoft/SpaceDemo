// Keeps the library up to date (plan 4.3): lists the demos in the person's folders, shows cached results at once,
// reads the rest in the background and tells the window as rows fill in. Only reads the person's files; writes only
// our own cache file.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MapFile } from '../../engine/src/map-index.js';
import type { LibraryDemo, LibraryState } from '../shared/api.js';
import {
  cached, demoStatus, findCandidates, loadCache, mapStatus, mergeDuplicates, saveCache,
  type CacheEntry, type Candidate,
} from './library.js';
import type { LibraryReader } from './reader.js';

export interface LibraryServiceOptions {
  cacheFile: string;
  reader: LibraryReader;
  roots: () => string[];
  mapFolders: () => string[];
  /** The Half-Life folder of today's game, if found. */
  gameDir: () => string | undefined;
  onChange: (state: LibraryState) => void;
  /** Shortest time between two updates sent to the window. */
  throttleMs?: number;
}

/** The game's own map folders (installed and downloaded maps). */
export function gameMapFolders(gameDir: string | undefined): string[] {
  if (!gameDir) return [];
  return ['cstrike/maps', 'cstrike_downloads/maps'].map((d) => join(gameDir, d)).filter((d) => existsSync(d));
}

export class LibraryService {
  private rows: { demo: LibraryDemo; candidate: Candidate }[] = [];
  private cache: Map<string, CacheEntry>;
  private maps: MapFile[] | undefined;
  private scan: { done: number; total: number } | undefined;
  private generation = 0;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly o: LibraryServiceOptions) {
    this.cache = loadCache(o.cacheFile);
  }

  state(): LibraryState {
    return { folders: this.o.roots(), demos: this.rows.map((r) => r.demo), scan: this.scan };
  }

  /** Lists the folders again and reads whatever is new or changed. Resolves when everything is read. */
  refresh(): Promise<void> {
    const gen = ++this.generation;
    this.running = this.run(gen);
    return this.running;
  }

  /** Waits for the current refresh (tests). */
  idle(): Promise<void> {
    return this.running;
  }

  private async run(gen: number): Promise<void> {
    const { candidates } = findCandidates(this.o.roots());
    this.rows = mergeDuplicates(candidates);
    const pool = this.o.mapFolders();
    for (const r of this.rows) {
      const hit = cached(this.cache, r.candidate);
      if (hit) this.fill(r.demo, hit, pool);
    }
    const todo = this.rows.filter((r) => r.demo.status === 'waiting');
    this.scan = todo.length ? { done: 0, total: todo.length } : undefined;
    this.emit(true);

    const mapFolders = [...gameMapFolders(this.o.gameDir()), ...pool];
    this.maps = mapFolders.length ? await this.o.reader.maps(mapFolders) : undefined;
    if (gen !== this.generation) return;
    for (const r of this.rows) if (r.demo.info) r.demo.map = mapStatus(r.demo.info, this.maps, pool);
    this.emit(true);

    for (const r of todo) {
      const res = await this.o.reader.demo(r.candidate);
      if (gen !== this.generation) return;
      const entry: CacheEntry = { size: r.candidate.size, mtime: r.candidate.mtime, ...res };
      this.cache.set(r.candidate.key, entry);
      this.fill(r.demo, entry, pool);
      this.scan = { done: this.scan!.done + 1, total: this.scan!.total };
      this.emit(false);
    }
    this.scan = undefined;
    // Forget demos that are no longer in any folder, then save.
    const live = new Set(candidates.map((c) => c.key));
    for (const k of [...this.cache.keys()]) if (!live.has(k)) this.cache.delete(k);
    try { saveCache(this.o.cacheFile, this.cache); } catch { /* the cache is only a speed-up */ }
    this.emit(true);
  }

  private fill(demo: LibraryDemo, e: CacheEntry, pool: string[]): void {
    demo.info = e.info;
    demo.error = e.error;
    demo.status = demoStatus(e.info, e.error);
    demo.map = e.info ? mapStatus(e.info, this.maps, pool) : undefined;
  }

  private emit(now: boolean): void {
    if (now) {
      if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
      this.o.onChange(this.state());
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.o.onChange(this.state()); }, this.o.throttleMs ?? 150);
  }

  close(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.o.reader.close();
  }
}
