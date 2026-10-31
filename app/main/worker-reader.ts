// LibraryReader that hands the work to the background thread (scan-worker).
import { Worker } from 'node:worker_threads';
import type { MapFile } from '../../engine/src/map-index.js';
import type { CombinedData, DemoDetails, DemoPlayers, ReplayData } from '../shared/api.js';
import type { DemoResult, LibraryReader } from './reader.js';
import type { FixResult } from './fixer.js';

export function workerReader(workerFile: string): LibraryReader {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, (msg: { maps?: MapFile[]; result?: DemoResult; details?: DemoDetails | { error: string }; replay?: ReplayData | { error: string }; combined?: CombinedData | { error: string }; players?: DemoPlayers | { error: string }; fix?: FixResult }) => void>();

  const start = (): Worker => {
    if (worker) return worker;
    const w = new Worker(workerFile);
    w.on('message', (msg: { id: number; maps?: MapFile[]; result?: DemoResult }) => {
      const done = pending.get(msg.id);
      pending.delete(msg.id);
      done?.(msg);
    });
    const fail = (why: string) => {
      worker = undefined;
      for (const [id, done] of pending) { pending.delete(id); done({ maps: [], result: { error: why } }); }
    };
    w.on('error', (err) => fail(`Reading stopped: ${err.message}`));
    w.on('exit', (code) => { if (code !== 0) fail('Reading stopped unexpectedly.'); });
    worker = w;
    return w;
  };

  const ask = <T>(job: object, pick: (m: { maps?: MapFile[]; result?: DemoResult; details?: DemoDetails | { error: string }; replay?: ReplayData | { error: string }; combined?: CombinedData | { error: string }; players?: DemoPlayers | { error: string }; fix?: FixResult }) => T) =>
    new Promise<T>((resolve) => {
      const id = nextId++;
      pending.set(id, (m) => resolve(pick(m)));
      start().postMessage({ id, ...job });
    });

  return {
    maps: (folders) => ask({ kind: 'maps', folders }, (m) => m.maps ?? []),
    demo: (c) => ask({ kind: 'demo', file: c.file, zipEntry: c.zipEntry }, (m) => m.result ?? { error: 'No answer.' }),
    details: (job) => ask({ kind: 'details', ...job }, (m) => m.details ?? { error: m.result?.error ?? 'No answer.' }),
    replay: (job, round, combined) => ask({ kind: 'replay', ...job, round, combined: combined === true }, (m) => m.replay ?? { error: m.result?.error ?? 'No answer.' }),
    combined: (job) => ask({ kind: 'combined', ...job }, (m) => m.combined ?? { error: m.result?.error ?? 'No answer.' }),
    players: (job) => ask({ kind: 'players', ...job }, (m) => m.players ?? { error: m.result?.error ?? 'No answer.' }),
    fix: (job) => ask({ kind: 'fix', ...job }, (m) => m.fix ?? { ok: false, error: m.result?.error ?? 'No answer.', done: [], notes: [] }),
    close: () => { void worker?.terminate(); worker = undefined; },
  };
}
