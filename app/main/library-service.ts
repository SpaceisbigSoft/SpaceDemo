// Keeps the library up to date (plan 4.3): lists the demos in the person's folders, shows cached results at once,
// reads the rest in the background and tells the window as rows fill in. Only reads the person's files; writes only
// our own cache file.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchMap, type MapFile } from '../../engine/src/map-index.js';
import type { CombinedData, DemoDetails, LibraryDemo, LibraryState, ReplayData } from '../shared/api.js';
import type { CompanionJob, DetailsJob } from './details.js';
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
  /** The app's valid fixed copy of a demo, if any (plan 4.5). */
  fixedCopy?: (key: string, source: { size: number; mtime: number }) => string | undefined;
  /** 4.10: whether this demo is fixed with AI voice (Settings, or the demo's own choice). */
  aiVoice?: (key: string) => boolean;
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
    demo.map = e.info ? mapStatus(e.info, this.maps, pool) : undefined;
    this.applyFixed(demo, this.rows.find((r) => r.demo === demo)?.candidate);
  }

  private applyFixed(demo: LibraryDemo, c: Candidate | undefined): void {
    demo.status = demoStatus(demo.info, demo.error);
    demo.fixedCopy = undefined;
    demo.aiVoice = this.o.aiVoice?.(demo.key);
    if (!c || (demo.status !== 'needs-fix' && demo.status !== 'damaged')) return;
    const copy = this.o.fixedCopy?.(demo.key, { size: c.size, mtime: c.mtime });
    if (copy) { demo.status = 'fixed'; demo.fixedCopy = copy; }
  }

  /** The row and where its demo is (for Watch and Fix). */
  row(key: string): { demo: LibraryDemo; candidate: Candidate } | undefined {
    return this.rows.find((r) => r.demo.key === key);
  }

  /** Call when what counts as a valid fixed copy changed (e.g. AI voice switched on or off): every row again. */
  fixedChangedAll(): void {
    for (const r of this.rows) this.applyFixed(r.demo, r.candidate);
    this.emit(true);
  }

  /** Call after a demo was fixed: its status becomes "Fixed · ready". */
  fixedChanged(key: string): void {
    const r = this.row(key);
    if (!r) return;
    this.applyFixed(r.demo, r.candidate);
    this.emit(true);
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

  /** Details of one library demo (plan 4.4). Only demos listed in the library can be asked for. */
  async details(key: string): Promise<DemoDetails | { error: string }> {
    const job = this.detailsJob(key);
    return 'error' in job ? job : this.o.reader.details(job);
  }

  /** 5.j: one round for the radar replay (5.r: with the other recordings of the same half added when `combined`). */
  async replay(key: string, round: number, combined = false): Promise<ReplayData | { error: string }> {
    const job = this.detailsJob(key);
    return 'error' in job ? job : this.o.reader.replay(job, round, combined);
  }

  /** 5.r: the other recordings of this demo's match, lined up and combined. */
  async combined(key: string): Promise<CombinedData | { error: string }> {
    const job = this.detailsJob(key);
    if ('error' in job) return job;
    return this.o.reader.combined({ ...job, companions: this.companions(key) });
  }

  /**
   * Library demos that may be recordings of the same match as `key`: same map version, recorded within 3 days, and 6+
   * of the same player names. Whether they really are (same rounds, or the other half) is decided by reading them.
   */
  companions(key: string): CompanionJob[] {
    const me = this.rows.find((r) => r.demo.key === key)?.demo;
    if (!me?.info) return [];
    const names = new Set(me.info.players);
    return this.rows.map((r) => r.demo).filter((d) => d.key !== key && d.info && d.info.map === me.info!.map && d.info.mapChecksum === me.info!.mapChecksum
      && Math.abs(d.date - me.date) <= 3 * 86_400_000 && d.info.players.filter((n) => names.has(n)).length >= 6)
      .map((d) => {
        const c = this.rows.find((r) => r.demo === d)!.candidate;
        return { key: d.key, name: d.name, file: c.file, zipEntry: c.zipEntry, recording: d.info!.recording };
      });
  }

  private detailsJob(key: string): DetailsJob | { error: string } {
    const row = this.rows.find((r) => r.demo.key === key);
    if (!row) return { error: "This demo isn't in the library any more." };
    const info = row.demo.info;
    if (!info) return { error: row.demo.error ?? 'This demo is still being read.' };
    const gameDir = this.o.gameDir();
    const gameMaps = gameMapFolders(gameDir).map((d) => d.toLowerCase());
    const m = this.maps ? matchMap(this.maps, info.map, info.mapChecksum) : undefined;
    const mapFile = m && (m.status === 'ok' || m.status === 'renamed') ? m.file.path : undefined;
    const mapIsInstalled = !!mapFile && m!.status === 'ok' && gameMaps.some((d) => mapFile.toLowerCase().startsWith(d));
    const overviewTxt = gameDir ? join(gameDir, 'cstrike', 'overviews', `${info.map}.txt`) : undefined;
    return { key, file: row.candidate.file, zipEntry: row.candidate.zipEntry, mapFile, overviewTxt, mapIsInstalled };
  }

  close(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.o.reader.close();
  }
}
