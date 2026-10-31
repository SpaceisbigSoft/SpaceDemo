// Demo library (plan 4.3): finds demos in the person's folders (loose .dem files and .dem files inside .zip files),
// sums up what the inspector says about each, merges identical copies, checks the map and keeps a cache so the next
// start is instant. Everything here only reads the person's files; the only file written is our own cache.
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { InspectReport } from '../../engine/src/inspect.js';
import { matchMap, type MapFile } from '../../engine/src/map-index.js';
import { listZip } from '../../engine/src/zip.js';
import type { DemoStatus, DemoSummary, LibraryDemo, MapStatus } from '../shared/api.js';

/** A demo found on disk, before it is read. */
export interface Candidate {
  key: string;
  name: string;
  file: string;
  zipEntry?: string;
  folder: string;
  size: number;
  /** File modification time (for the cache: a changed file is read again). */
  mtime: number;
  date: number;
  dateSource: 'zip' | 'file';
}

/** Today's CS 1.6 network protocol (Steam build 10210). */
export const CURRENT_PROTOCOL = 48;

const isDem = (p: string) => extname(p).toLowerCase() === '.dem';
const isZip = (p: string) => extname(p).toLowerCase() === '.zip';

/** Lists every demo under the library folders. Unreadable folders, files and zips are skipped; their problems are returned. */
export function findCandidates(roots: string[]): { candidates: Candidate[]; problems: string[] } {
  const candidates: Candidate[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  const addFile = (path: string, folder: string) => {
    let st;
    try { st = statSync(path); } catch { return; }
    if (isDem(path)) {
      if (seen.has(path)) return;
      seen.add(path);
      candidates.push({ key: path, name: basename(path, extname(path)), file: path, folder, size: st.size, mtime: st.mtimeMs, date: st.mtimeMs, dateSource: 'file' });
    } else if (isZip(path)) {
      let entries;
      try {
        entries = listZip(path);
      } catch (err) {
        problems.push((err as Error).message);
        return;
      }
      for (const e of entries) {
        if (!isDem(e.name)) continue;
        const key = `${path}::${e.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const base = e.name.split('/').pop()!;
        candidates.push({
          key,
          name: base.slice(0, -4),
          file: path,
          zipEntry: e.name,
          folder,
          size: e.size,
          mtime: st.mtimeMs,
          date: e.modified?.getTime() ?? st.mtimeMs,
          dateSource: e.modified ? 'zip' : 'file',
        });
      }
    }
  };

  const walk = (dir: string, folder: string, depth: number) => {
    if (depth > 12) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { problems.push(`Can't open the folder ${dir}.`); return; }
    for (const e of entries.sort()) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, folder, depth + 1);
      else if (st.isFile()) addFile(p, folder);
    }
  };

  for (const root of roots) {
    let st;
    try { st = statSync(root); } catch { problems.push(`${root} can't be found (moved, renamed or on a drive that isn't connected).`); continue; }
    if (st.isDirectory()) walk(root, root, 0);
    else addFile(root, dirname(root));
  }
  return { candidates, problems };
}

/** The small part of an inspector report the library keeps. */
export function summarize(r: InspectReport): DemoSummary {
  const talkers = r.players.filter((p) => p.talkBursts > 0 && !p.isHltv).map((p) => p.name).filter(Boolean);
  const voiceSeconds = r.players.some((p) => p.voiceSeconds !== undefined)
    ? r.players.reduce((s, p) => s + (p.voiceSeconds ?? 0), 0)
    : undefined;
  return {
    networkProtocol: r.networkProtocol,
    gameDir: r.gameDir,
    recording: r.recording,
    map: r.maps[0] ?? r.mapName,
    maps: r.maps,
    mapChecksum: r.mapChecksum,
    seconds: r.seconds,
    hostName: r.hostName?.trim() || undefined,
    voiceCodec: r.voiceCodec,
    voiceSeconds,
    talkBursts: r.players.reduce((s, p) => s + p.talkBursts, 0),
    talkers,
    players: r.players.filter((p) => !p.isHltv && p.name).map((p) => p.name),
    recorder: r.players.find((p) => p.isRecorder)?.name,
    directoryOk: r.directoryOk,
    problems: [...r.problems],
  };
}

export function demoStatus(info: DemoSummary | undefined, error: string | undefined): DemoStatus {
  if (error) return 'unreadable';
  if (!info) return 'waiting';
  if (info.gameDir.toLowerCase() !== 'cstrike') return 'not-cs';
  if (!info.directoryOk) return 'damaged';
  if (info.networkProtocol < CURRENT_PROTOCOL) return 'needs-fix';
  // Old-format voice (Miles, Speex) isn't heard in today's game until it's put back as Steam voice (2.8, 2.17).
  if (info.voiceCodec && info.talkBursts > 0) return 'needs-fix';
  return 'plays';
}

/** Is the map this demo starts on available, and where? */
export function mapStatus(info: DemoSummary, maps: MapFile[] | undefined, poolFolders: string[]): MapStatus {
  if (!maps) return { kind: 'unknown', note: 'not checked' };
  const m = matchMap(maps, info.map, info.mapChecksum);
  const inPool = (f: MapFile) => poolFolders.some((d) => f.path.toLowerCase().startsWith(d.toLowerCase()));
  switch (m.status) {
    case 'ok':
      return { kind: 'ok', note: inPool(m.file) ? 'old version · map pool' : 'installed' };
    case 'renamed':
      return { kind: 'ok', note: `found as ${m.file.name}${inPool(m.file) ? ' · map pool' : ''}` };
    case 'wrongVersion':
      return { kind: 'warn', note: 'different version installed' };
    case 'missing':
      return { kind: 'bad', note: 'map missing' };
  }
}

/**
 * One row per demo: identical copies (same name, ignoring case, and same size) are shown and read once. The row uses a
 * loose file when there is one (playable without unpacking), keeps the earliest date (a zip's 2002 date beats the
 * date the file was unpacked) and lists the other places in alsoAt. Rows come newest first.
 */
export function mergeDuplicates(candidates: Candidate[]): { demo: LibraryDemo; candidate: Candidate }[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const id = `${c.name.toLowerCase()}|${c.size}`;
    const g = groups.get(id);
    if (g) g.push(c); else groups.set(id, [c]);
  }
  const out: { demo: LibraryDemo; candidate: Candidate }[] = [];
  for (const g of groups.values()) {
    const best = [...g].sort((a, b) => Number(!!a.zipEntry) - Number(!!b.zipEntry) || a.date - b.date)[0];
    const earliest = [...g].sort((a, b) => a.date - b.date)[0];
    out.push({
      candidate: best,
      demo: {
        key: best.key,
        name: best.name,
        file: best.file,
        zipEntry: best.zipEntry,
        folder: best.folder,
        size: best.size,
        date: earliest.date,
        dateSource: earliest.dateSource,
        alsoAt: g.filter((c) => c !== best).map((c) => (c.zipEntry ? `${c.file} → ${c.zipEntry}` : c.file)),
        status: 'waiting',
      },
    });
  }
  return out.sort((a, b) => b.demo.date - a.demo.date || a.demo.name.localeCompare(b.demo.name));
}

// ---------- Cache ----------

export interface CacheEntry {
  size: number;
  mtime: number;
  info?: DemoSummary;
  error?: string;
}

/** Bump when DemoSummary changes, so old caches are read again. */
export const CACHE_VERSION = 1;

export function loadCache(file: string): Map<string, CacheEntry> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { v: number; demos: Record<string, CacheEntry> };
    if (raw.v !== CACHE_VERSION || !raw.demos) return new Map();
    return new Map(Object.entries(raw.demos));
  } catch {
    return new Map();
  }
}

export function saveCache(file: string, cache: Map<string, CacheEntry>): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, demos: Object.fromEntries(cache) }), 'utf8');
  renameSync(tmp, file);
}

/** The cached result for a candidate, if the file hasn't changed since. */
export function cached(cache: Map<string, CacheEntry>, c: Candidate): CacheEntry | undefined {
  const e = cache.get(c.key);
  return e && e.size === c.size && e.mtime === c.mtime ? e : undefined;
}
