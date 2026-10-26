// Watch from the app (plan 4.5): fix the demo if it needs it (a new fixed copy; the original is only read), then start
// CS 1.6 through Steam with the 3.2 launcher (-insecure, copy in cstrike\cdf_test) and remove that copy when the game
// closes (3.5). Anti-cheat rule: nothing here touches the game's memory or its own files.
import { cleanupCopies, waitForGameClose } from '../../engine/src/launch/cleanup.js';
import { isGameRunning, launch, planLaunch, type LaunchPlan } from '../../engine/src/launch/launch.js';
import type { FindResult } from '../../engine/src/launch/steam.js';
import type { WatchInfo, WatchProgress } from '../shared/api.js';
import { fixedOutputPath, type FixedStore } from './fixed-store.js';
import type { FixService } from './fix-service.js';
import type { LibraryService } from './library-service.js';

export interface WatchDeps {
  library: LibraryService;
  fixed: FixedStore;
  fixer: FixService;
  findGame: () => FindResult;
  outputFolder: () => string;
  onProgress: (p: WatchProgress) => void;
  /** Replaceable in tests: starting Steam, checking whether the game runs, waiting. */
  start?: (exe: string, args: string[]) => void;
  gameRunning?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Don't wait for the game to close (tests). */
  noWait?: boolean;
}

export class WatchService {
  private busy = false;

  constructor(private readonly d: WatchDeps) {}

  info(key: string): WatchInfo | { error: string } {
    const row = this.d.library.row(key);
    if (!row) return { error: "This demo isn't in the library any more." };
    const { demo } = row;
    const i = demo.info;
    if (!i) return { error: demo.error ?? 'This demo is still being read.' };
    const problems: string[] = [];
    const warnings: string[] = [];
    if (demo.status === 'not-cs') problems.push(`This demo is for "${i.gameDir}", not Counter-Strike.`);
    const found = this.d.findGame();
    if (!found.steam) problems.push('Steam wasn\'t found.');
    if (!found.game) problems.push('Counter-Strike 1.6 wasn\'t found (see Settings).');
    if (demo.map && demo.map.note !== 'installed' && demo.map.kind !== 'unknown') {
      warnings.push(`This demo needs a ${demo.map.kind === 'bad' ? 'map that isn\'t found' : `different version of ${i.map} (${demo.map.note})`}. Putting old map versions in place for playback isn't built yet, so the game may stop with a map error when it loads.`);
    }
    const needsFix = this.needsFix(key);
    return {
      key,
      name: demo.name,
      mode: i.maps.length > 1 ? 'playdemo' : 'viewdemo',
      maps: i.maps,
      needsFix,
      fixedCopy: demo.fixedCopy ?? (needsFix ? fixedOutputPath(this.d.outputFolder(), demo.name, this.d.fixed.ownOutput(key)).path : undefined),
      problems,
      warnings,
    };
  }

  /** True unless the demo plays as it is (a loose protocol-48 file) or has a valid fixed copy. */
  private needsFix(key: string): boolean {
    const row = this.d.library.row(key)!;
    if (row.demo.status === 'fixed') return false;
    return row.demo.status !== 'plays' || !!row.candidate.zipEntry;
  }

  async watch(key: string, options: { speed?: number; keepCopy?: boolean } = {}): Promise<WatchProgress> {
    const say = (p: Omit<WatchProgress, 'key'>): WatchProgress => { const full = { key, ...p }; this.d.onProgress(full); return full; };
    if (this.busy) return say({ stage: 'error', message: 'Another demo is being started; wait for it first.' });
    const info = this.info(key);
    if ('error' in info) return say({ stage: 'error', message: info.error });
    if (info.problems.length) return say({ stage: 'error', message: info.problems.join(' ') });
    this.busy = true;
    try {
      const row = this.d.library.row(key)!;
      const found = this.d.findGame();
      let source = row.demo.fixedCopy ?? (row.candidate.zipEntry ? undefined : row.candidate.file);
      let done: string[] | undefined;
      let notes: string[] | undefined;

      if (info.needsFix) {
        say({ stage: 'fixing', message: 'Fixing: repairing, converting for today\'s CS 1.6 and putting the original voice back…' });
        const r = await this.d.fixer.fixOne(key, row.candidate, row.demo.name);
        if (!r.ok || !r.output) return say({ stage: 'error', message: `Fixing didn't work: ${r.error}` });
        source = r.output;
        done = r.done;
        notes = r.notes;
      }
      if (!source) return say({ stage: 'error', message: 'No playable copy of this demo.' });

      say({ stage: 'starting', message: 'Starting Counter-Strike through Steam…', done, notes });
      let plan: LaunchPlan;
      try {
        plan = planLaunch(source, found.steam!, found.game!, { mode: 'auto', speed: options.speed ?? 1 });
      } catch (err) {
        return say({ stage: 'error', message: (err as Error).message, done, notes });
      }
      const running = this.d.gameRunning ?? isGameRunning;
      const res = launch(plan, { gameRunning: running, start: this.d.start, keepCopy: options.keepCopy });
      if (!res.started) return say({ stage: 'error', message: res.message, done, notes });
      const playing = say({ stage: 'playing', message: res.message, done, notes });
      if (this.d.noWait) return playing;

      // When the game closes, remove the copy we put in cdf_test (unless the person asked to keep it).
      void waitForGameClose(running, { sleep: this.d.sleep }).then((how) => {
        const removed = how === 'closed' && !options.keepCopy ? cleanupCopies(plan.cstrikeDir).removed.length : 0;
        say({ stage: 'done', message: how === 'never-started' ? 'The game didn\'t start (or closed at once).' : `Counter-Strike closed.${removed ? ' The copy in the game folder was removed.' : ''}`, done, notes });
      });
      return playing;
    } finally {
      this.busy = false;
    }
  }
}
