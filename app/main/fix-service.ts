// Fixing demos (plans 4.5–4.6): one demo for Watch, or a batch from the Fix & convert page / the library's "Fix all".
// Each demo is fixed in the background thread (fixer.ts) into the fixed-demos folder; the original — a .dem or the .zip
// holding it — is only read. Demos are done one at a time; Stop finishes the current one and skips the rest.
import { statSync } from 'node:fs';
import type { FixBatchState, FixItem } from '../shared/api.js';
import { fixedOutputPath, type FixedStore } from './fixed-store.js';
import type { FixJob, FixResult } from './fixer.js';
import type { Candidate } from './library.js';
import type { LibraryService } from './library-service.js';
import type { LibraryReader } from './reader.js';

export interface FixServiceDeps {
  library: LibraryService;
  reader: LibraryReader;
  fixed: FixedStore;
  gameDir: () => string | undefined;
  outputFolder: () => string;
  helperExe: string;
  /** Voice cleanup setting (default on). */
  cleanup?: () => boolean;
  /** 5.g5/4.10: AI voice enhancement for this demo's fix (undefined = plain). */
  ai?: (key: string) => FixJob['ai'];
  /** 0.8: Settings → Old map versions. */
  mapFolders?: () => string[];
  onChange: (s: FixBatchState) => void;
}

export function voiceText(r: Pick<FixResult, 'voice' | 'ai'>, hadVoice: boolean | undefined): string {
  if (r.voice && r.voice.seconds > 0) return `${(r.voice.seconds / 60).toFixed(1)} min · ${r.voice.bursts} bursts${r.ai ? ' · AI' : ''}`;
  return hadVoice === false ? 'none in this demo' : 'not restored';
}

export class FixService {
  private items: FixItem[] = [];
  private queue: { item: FixItem; candidate: Candidate; hadVoice?: boolean }[] = [];
  private running = false;
  private stopRequested = false;

  constructor(private readonly d: FixServiceDeps) {}

  state(): FixBatchState {
    return { items: this.items.map((i) => ({ ...i })), running: this.running, outputFolder: this.d.outputFolder() };
  }

  /** Fixes one demo now (Watch). Records the fixed copy and updates the library row. */
  async fixOne(key: string, c: Candidate, name: string, onProgress?: (p: { done: number; total: number }) => void): Promise<FixResult> {
    const out = fixedOutputPath(this.d.outputFolder(), name, this.d.fixed.ownOutput(key));
    const r = await this.d.reader.fix({
      file: c.file, zipEntry: c.zipEntry, output: out.path, overwrite: out.overwrite,
      gameDir: this.d.gameDir(), helperExe: this.d.helperExe, cleanup: this.d.cleanup?.() ?? true, ai: this.d.ai?.(key), mapFolders: this.d.mapFolders?.(),
    }, onProgress);
    if (r.ok && r.output) {
      this.d.fixed.set(key, { output: r.output, size: c.size, mtime: c.mtime, fixedAt: Date.now(), outputSize: statSync(r.output).size, done: r.done, notes: r.notes, ai: r.ai, aiStyle: r.aiStyle, oldMap: r.oldMap });
      this.d.library.fixedChanged(key);
    }
    return r;
  }

  /** Adds library demos to the batch (already fixed or waiting ones are left out). */
  addLibrary(keys: string[]): FixBatchState {
    for (const key of keys) {
      const row = this.d.library.row(key);
      if (!row || this.queue.some((q) => q.item.key === key)) continue;
      this.add(key, row.candidate, row.demo.info?.map, true, row.demo.info ? row.demo.info.talkBursts > 0 : undefined);
    }
    this.kick();
    return this.state();
  }

  /** Adds demos found in files the person picked or dropped (loose .dem files and .dem files inside zips). */
  addCandidates(candidates: Candidate[]): FixBatchState {
    for (const c of candidates) {
      if (this.queue.some((q) => q.item.key === c.key)) continue;
      const lib = this.d.library.row(c.key);
      this.add(c.key, c, lib?.demo.info?.map, !!lib, lib?.demo.info ? lib.demo.info.talkBursts > 0 : undefined);
    }
    this.kick();
    return this.state();
  }

  stop(): FixBatchState {
    if (this.running) this.stopRequested = true;
    return this.state();
  }

  private add(key: string, candidate: Candidate, map: string | undefined, inLibrary: boolean, hadVoice: boolean | undefined): void {
    // A demo shown again replaces its old line in the results.
    this.items = this.items.filter((i) => i.key !== key);
    const item: FixItem = { key, name: candidate.name, map, state: 'waiting', done: [], notes: [], inLibrary };
    this.items.push(item);
    this.queue.push({ item, candidate, hadVoice });
  }

  private kick(): void {
    this.d.onChange(this.state());
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    try {
      for (;;) {
        const next = this.queue.find((q) => q.item.state === 'waiting');
        if (!next) break;
        if (this.stopRequested) {
          for (const q of this.queue) if (q.item.state === 'waiting') q.item.state = 'skipped';
          break;
        }
        next.item.state = 'fixing';
        this.d.onChange(this.state());
        let lastSent = 0;
        const r = await this.fixOne(next.item.key, next.candidate, next.item.name, ({ done, total }) => {
          next.item.progress = `AI voice ${Math.round(done)} of ${Math.round(total)} s`;
          if (Date.now() - lastSent > 500 || done >= total) { lastSent = Date.now(); this.d.onChange(this.state()); }
        });
        next.item.progress = undefined;
        Object.assign(next.item, r.ok
          ? { state: 'fixed', seconds: r.seconds, voice: voiceText(r, next.hadVoice), ai: r.ai, done: r.done, notes: r.notes, output: r.output }
          : { state: 'failed', error: r.error });
        this.d.onChange(this.state());
      }
    } finally {
      this.queue = this.queue.filter((q) => q.item.state === 'waiting' || q.item.state === 'fixing');
      this.running = false;
      this.stopRequested = false;
      this.d.onChange(this.state());
    }
  }
}
