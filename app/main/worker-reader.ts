// LibraryReader that hands the work to the background thread (scan-worker).
import { Worker } from 'node:worker_threads';
import type { MapFile } from '../../engine/src/map-index.js';
import type { DemoResult, LibraryReader } from './reader.js';

export function workerReader(workerFile: string): LibraryReader {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, (msg: { maps?: MapFile[]; result?: DemoResult }) => void>();

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

  const ask = <T>(job: object, pick: (m: { maps?: MapFile[]; result?: DemoResult }) => T) =>
    new Promise<T>((resolve) => {
      const id = nextId++;
      pending.set(id, (m) => resolve(pick(m)));
      start().postMessage({ id, ...job });
    });

  return {
    maps: (folders) => ask({ kind: 'maps', folders }, (m) => m.maps ?? []),
    demo: (c) => ask({ kind: 'demo', file: c.file, zipEntry: c.zipEntry }, (m) => m.result ?? { error: 'No answer.' }),
    close: () => { void worker?.terminate(); worker = undefined; },
  };
}
