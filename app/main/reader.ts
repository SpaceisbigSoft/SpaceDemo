// Reading demos and maps for the library (plan 4.3). The same work runs either in a background thread (the app: the
// window never waits) or directly (tests). Only reads files.
import { readFileSync } from 'node:fs';
import { inspectDemo } from '../../engine/src/inspect.js';
import { indexMaps, type MapFile } from '../../engine/src/map-index.js';
import { readZipEntry } from '../../engine/src/zip.js';
import type { DemoSummary } from '../shared/api.js';
import { summarize, type Candidate } from './library.js';

export interface DemoResult { info?: DemoSummary; error?: string }

export interface LibraryReader {
  maps(folders: string[]): Promise<MapFile[]>;
  demo(c: Pick<Candidate, 'file' | 'zipEntry'>): Promise<DemoResult>;
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

/** Reads in this thread. Used by tests and as a fallback. */
export function directReader(): LibraryReader {
  return {
    maps: async (folders) => indexMaps(folders),
    demo: async (c) => readDemoNow(c),
    close: () => {},
  };
}
