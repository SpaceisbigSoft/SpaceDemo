// Background thread for the library (plan 4.3): reads demos and indexes maps so the app's main thread stays free.
// Jobs arrive one at a time and are answered in order. Only reads files.
import { parentPort } from 'node:worker_threads';
import { indexMaps } from '../../engine/src/map-index.js';
import { readDemoNow } from './reader.js';
import { readDetails, type DetailsJob } from './details.js';

type Job =
  | { id: number; kind: 'maps'; folders: string[] }
  | { id: number; kind: 'demo'; file: string; zipEntry?: string }
  | ({ id: number; kind: 'details' } & DetailsJob);

parentPort!.on('message', (job: Job) => {
  if (job.kind === 'maps') {
    let maps: ReturnType<typeof indexMaps> = [];
    try { maps = indexMaps(job.folders); } catch { /* unreadable folders give no maps */ }
    parentPort!.postMessage({ id: job.id, maps });
  } else if (job.kind === 'details') {
    parentPort!.postMessage({ id: job.id, details: readDetails(job) });
  } else {
    parentPort!.postMessage({ id: job.id, result: readDemoNow(job) });
  }
});
