// Background thread for the library (plan 4.3): reads demos and indexes maps so the app's main thread stays free.
// Jobs arrive one at a time and are answered in order. Only reads files.
import { parentPort } from 'node:worker_threads';
import { indexMaps } from '../../engine/src/map-index.js';
import { readDemoNow, readPlayersNow, type PlayersJob } from './reader.js';
import { readCombined, readDetails, readReplay, type CompanionJob, type DetailsJob } from './details.js';
import { runFix, type FixJob } from './fixer.js';
import { writeBursts, type BurstsJob } from './voice-bursts.js';

type Job =
  | { id: number; kind: 'maps'; folders: string[] }
  | { id: number; kind: 'demo'; file: string; zipEntry?: string }
  | ({ id: number; kind: 'details' } & DetailsJob)
  | ({ id: number; kind: 'replay'; round: number; combined?: boolean } & DetailsJob)
  | ({ id: number; kind: 'combined'; companions: CompanionJob[] } & DetailsJob)
  | ({ id: number; kind: 'players' } & PlayersJob)
  | ({ id: number; kind: 'fix' } & FixJob)
  | ({ id: number; kind: 'bursts' } & BurstsJob);

parentPort!.on('message', (job: Job) => {
  if (job.kind === 'maps') {
    let maps: ReturnType<typeof indexMaps> = [];
    try { maps = indexMaps(job.folders); } catch { /* unreadable folders give no maps */ }
    parentPort!.postMessage({ id: job.id, maps });
  } else if (job.kind === 'bursts') {
    parentPort!.postMessage({ id: job.id, bursts: writeBursts(job) });
  } else if (job.kind === 'fix') {
    void runFix(job, (progress) => parentPort!.postMessage({ id: job.id, progress })).then((fix) => parentPort!.postMessage({ id: job.id, fix }));
  } else if (job.kind === 'players') {
    parentPort!.postMessage({ id: job.id, players: readPlayersNow(job) });
  } else if (job.kind === 'replay') {
    parentPort!.postMessage({ id: job.id, replay: readReplay(job, job.round, job.combined === true) });
  } else if (job.kind === 'combined') {
    parentPort!.postMessage({ id: job.id, combined: readCombined(job) });
  } else if (job.kind === 'details') {
    parentPort!.postMessage({ id: job.id, details: readDetails(job) });
  } else {
    parentPort!.postMessage({ id: job.id, result: readDemoNow(job) });
  }
});
