// Which demos the app has fixed, and where the fixed copies are (plans 4.5/4.6). Kept in %APPDATA%\SpaceDemo\fixed.json.
// A record counts only while the original is unchanged (same size and date) and the fixed copy still exists.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export interface FixedRecord {
  /** The fixed copy. */
  output: string;
  /** The original as it was when fixed. */
  size: number;
  mtime: number;
  fixedAt: number;
  /** Size of the fixed copy when written (to notice if it's replaced by something else). */
  outputSize: number;
  done: string[];
  notes: string[];
  /** 5.g5: made with AI voice enhancement. */
  ai?: boolean;
  /** 5.g6: version of the AI voice (AI_STYLE in engine/src/voice/enhance.ts); older AI copies are made again. */
  aiStyle?: number;
  /** 0.8: the old map this copy plays on (cstrike_downloads\maps\<installName>.bsp). */
  oldMap?: { source: string; installName: string };
}

export class FixedStore {
  private records: Record<string, FixedRecord>;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { v: number; fixed: Record<string, FixedRecord> };
      this.records = raw.v === 1 && raw.fixed ? raw.fixed : {};
    } catch {
      this.records = {};
    }
  }

  /** The fixed copy of this demo, if it is still valid. */
  get(key: string, source: { size: number; mtime: number }): FixedRecord | undefined {
    const r = this.records[key];
    if (!r || r.size !== source.size || r.mtime !== source.mtime) return undefined;
    try {
      if (!existsSync(r.output) || statSync(r.output).size !== r.outputSize) return undefined;
    } catch {
      return undefined;
    }
    return r;
  }

  /** The record as stored, valid or not. */
  peek(key: string): FixedRecord | undefined {
    return this.records[key];
  }

  /** Our own earlier output for this demo (valid or not), so it may be replaced by a new fix. */
  ownOutput(key: string): string | undefined {
    return this.records[key]?.output;
  }

  set(key: string, r: FixedRecord): void {
    this.records[key] = r;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, fixed: this.records }, null, 1), 'utf8');
    renameSync(tmp, this.file);
  }
}

/**
 * Where the fixed copy goes: <folder>\<name>_fixed.dem. Our own earlier copy of the same demo is replaced; any other
 * existing file is never touched (the next free name _fixed_2, _fixed_3… is used).
 */
export function fixedOutputPath(folder: string, demoName: string, ownEarlier: string | undefined): { path: string; overwrite: boolean } {
  const base = basename(demoName, extname(demoName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  for (let n = 1; ; n++) {
    const p = join(folder, `${base}_fixed${n === 1 ? '' : `_${n}`}.dem`);
    if (ownEarlier && p.toLowerCase() === ownEarlier.toLowerCase()) return { path: p, overwrite: true };
    if (!existsSync(p)) return { path: p, overwrite: false };
  }
}
