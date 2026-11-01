// Reading demos and maps for the library (plan 4.3). The same work runs either in a background thread (the app: the
// window never waits) or directly (tests). Only reads files.
import { readFileSync } from 'node:fs';
import { writeBursts, type BurstsJob, type BurstsResult } from './voice-bursts.js';
import { inspectDemo } from '../../engine/src/inspect.js';
import { indexMaps, type MapFile } from '../../engine/src/map-index.js';
import { readZipEntry } from '../../engine/src/zip.js';
import type { CombinedData, DemoDetails, DemoPlayers, DemoSummary, ReplayData } from '../shared/api.js';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import { demoPlayers } from './players.js';
import { readCombined, readDetails, readReplay, type CompanionJob, type DetailsJob } from './details.js';
import { runFix, type FixJob, type FixResult } from './fixer.js';
import { summarize, type Candidate } from './library.js';

export interface DemoResult { info?: DemoSummary; error?: string }

export interface LibraryReader {
  maps(folders: string[]): Promise<MapFile[]>;
  demo(c: Pick<Candidate, 'file' | 'zipEntry'>): Promise<DemoResult>;
  details(job: DetailsJob): Promise<DemoDetails | { error: string }>;
  replay(job: DetailsJob, round: number, combined?: boolean): Promise<ReplayData | { error: string }>;
  combined(job: DetailsJob & { companions: CompanionJob[] }): Promise<CombinedData | { error: string }>;
  players(job: PlayersJob): Promise<DemoPlayers | { error: string }>;
  fix(job: FixJob): Promise<FixResult>;
  /** 5.v: the demo's talk bursts as WAV files in a temporary folder. */
  bursts(job: BurstsJob): Promise<BurstsResult>;
  close(): void;
}

export function readDemoNow(c: Pick<Candidate, 'file' | 'zipEntry'>): DemoResult {
  try {
    const bytes = c.zipEntry ? readZipEntry(c.file, c.zipEntry) : readFileSync(c.file);
    return { info: summarize(inspectDemo(bytes)) };
  } catch (err) {
    return { error: plainError(err) };
  }
}

function plainError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/EACCES|EPERM/.test(msg)) return "Windows didn't allow reading this file.";
  if (/ENOENT/.test(msg)) return 'The file is gone (moved or deleted).';
  return msg;
}

export interface PlayersJob { key: string; file: string; zipEntry?: string; name: string; date: number; map: string }

/** 5.p: one demo's players for the totals. */
export function readPlayersNow(job: PlayersJob): DemoPlayers | { error: string } {
  try {
    const bytes = job.zipEntry ? readZipEntry(job.file, job.zipEntry) : readFileSync(job.file);
    return demoPlayers(extractMatch(readDemo(bytes)), job);
  } catch (err) {
    return { error: plainError(err) };
  }
}

/** Reads in this thread. Used by tests and as a fallback. */
export function directReader(): LibraryReader {
  return {
    maps: async (folders) => indexMaps(folders),
    demo: async (c) => readDemoNow(c),
    details: async (job) => readDetails(job),
    replay: async (job, round, combined) => readReplay(job, round, combined),
    combined: async (job) => readCombined(job),
    players: async (job) => readPlayersNow(job),
    fix: async (job) => runFix(job),
    bursts: async (job) => writeBursts(job),
    close: () => {},
  };
}
