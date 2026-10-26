// Cleanup after playback (plan 3.5). The launcher copies fixed demos into cstrike\cdf_test\ for the game to read; this
// module remembers which files it made there (cstrike\cdf_test\cdf_copies.json) and removes exactly those once the game
// has closed. Files someone else put in cdf_test are never listed, so never removed; a listed file that has changed
// since it was made (different size or contents) is left alone too. Nothing outside cdf_test is ever removed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { writeNewFile } from '../fix/safe-output.js';

export const DEMO_FOLDER = 'cdf_test';

export interface CopyRecord {
  /** Path inside cdf_test, forward slashes. */
  file: string;
  size: number;
  sha256: string;
  /** The fixed demo it was copied from. */
  source: string;
  createdAt: string;
}

export function manifestFile(cstrikeDir: string): string {
  return join(cstrikeDir, DEMO_FOLDER, 'cdf_copies.json');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readManifest(cstrikeDir: string): CopyRecord[] {
  try {
    const list = JSON.parse(readFileSync(manifestFile(cstrikeDir), 'utf8'));
    return Array.isArray(list) ? list.filter((r) => r && typeof r.file === 'string') : [];
  } catch {
    return [];
  }
}

function writeManifest(cstrikeDir: string, list: CopyRecord[]): void {
  const f = manifestFile(cstrikeDir);
  if (!list.length) { if (existsSync(f)) unlinkSync(f); return; }
  writeNewFile([], f, Buffer.from(JSON.stringify(list, null, 2), 'utf8'), { overwrite: true });
}

/** The full path of a manifest entry, or undefined when it would point outside cdf_test (a damaged list). */
function fullPath(cstrikeDir: string, file: string): string | undefined {
  const folder = resolve(cstrikeDir, DEMO_FOLDER);
  const p = resolve(folder, file);
  const rel = relative(folder, p);
  if (!rel || rel.startsWith('..') || rel.includes(':') || rel.startsWith(sep) || !/\.dem$/i.test(p)) return undefined;
  try { if (existsSync(p) && relative(realpathSync(folder), realpathSync(p)).startsWith('..')) return undefined; } catch { return undefined; }
  return p;
}

export function isListedCopy(cstrikeDir: string, target: string): boolean {
  const folder = resolve(cstrikeDir, DEMO_FOLDER);
  const rel = relative(folder, resolve(target)).replace(/\\/g, '/');
  return readManifest(cstrikeDir).some((r) => r.file.toLowerCase() === rel.toLowerCase());
}

/** Notes a file the launcher has just made in cdf_test. */
export function recordCopy(cstrikeDir: string, target: string, bytes: Uint8Array, source: string, now = new Date()): void {
  const folder = resolve(cstrikeDir, DEMO_FOLDER);
  const file = relative(folder, resolve(target)).replace(/\\/g, '/');
  if (!fullPath(cstrikeDir, file)) throw new Error(`${target} is not inside ${folder}.`);
  const list = readManifest(cstrikeDir).filter((r) => r.file.toLowerCase() !== file.toLowerCase());
  list.push({ file, size: bytes.length, sha256: sha256(bytes), source: resolve(source), createdAt: now.toISOString() });
  writeManifest(cstrikeDir, list);
}

export interface CleanupResult {
  removed: string[];
  /** Listed files left alone because they changed since the launcher made them. */
  changed: string[];
}

/** Removes the copies the launcher made (except `keep`). Call only while the game is closed. */
export function cleanupCopies(cstrikeDir: string, options: { keep?: string[] } = {}): CleanupResult {
  const keep = new Set((options.keep ?? []).map((k) => resolve(k).toLowerCase()));
  const removed: string[] = [], changed: string[] = [];
  const left: CopyRecord[] = [];
  for (const r of readManifest(cstrikeDir)) {
    const p = fullPath(cstrikeDir, r.file);
    if (!p || !existsSync(p)) continue; // gone already (or a damaged entry): forget it
    if (keep.has(p.toLowerCase())) { left.push(r); continue; }
    let same = false;
    try { same = statSync(p).size === r.size && sha256(new Uint8Array(readFileSync(p))) === r.sha256; } catch { same = false; }
    if (!same) { changed.push(p); continue; } // not ours any more: leave it, stop tracking it
    unlinkSync(p);
    removed.push(p);
  }
  writeManifest(cstrikeDir, left);
  return { removed, changed };
}

/** Waits until the game has started (up to `startTimeoutMs`) and then until it has closed. */
export async function waitForGameClose(running: () => boolean, deps: { sleep?: (ms: number) => Promise<void>; startTimeoutMs?: number; pollMs?: number } = {}): Promise<'closed' | 'never-started'> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const poll = deps.pollMs ?? 2000, limit = deps.startTimeoutMs ?? 120_000;
  let waited = 0;
  while (!running()) {
    if (waited >= limit) return 'never-started';
    await sleep(poll);
    waited += poll;
  }
  while (running()) await sleep(poll);
  await sleep(1500); // let the game let go of the demo file
  return 'closed';
}
