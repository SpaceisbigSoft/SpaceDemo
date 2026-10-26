// Fixing a demo from the app (plans 4.5/4.6): the same one-step fix as `npm run fix` (repair, convert to protocol 48,
// original voice back as Steam voice with voice cleanup on). Runs in the background thread. The original (a .dem, or the
// .zip that holds it) is only read; the fixed copy is a new file written through writeNewFile().
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fixDemo } from '../../engine/src/fix/fix.js';
import { writeNewFile } from '../../engine/src/fix/safe-output.js';
import { voiceCleanup } from '../../engine/src/voice/cleanup.js';
import { helperDecoder } from '../../engine/src/voice/decoders.js';
import { readZipEntry } from '../../engine/src/zip.js';

export interface FixJob {
  /** The .dem, or the .zip holding it. */
  file: string;
  zipEntry?: string;
  output: string;
  /** Allowed only when the output is our own earlier fixed copy of this demo. */
  overwrite: boolean;
  /** Half-Life folder of today's game (sprite/model check, and its mssvoice.asi for the old voice). */
  gameDir?: string;
  /** Our voice helper (helpers/voice-helper/cdf-voice-helper.exe). */
  helperExe?: string;
  /** Voice cleanup (owner's default: on). */
  cleanup: boolean;
}

export interface FixResult {
  ok: boolean;
  output?: string;
  error?: string;
  seconds?: number;
  /** What was done, in plain words. */
  done: string[];
  /** Things to know (e.g. voice left as is). */
  notes: string[];
}

export function runFix(job: FixJob): FixResult {
  const t0 = Date.now();
  try {
    const input = job.zipEntry ? readZipEntry(job.file, job.zipEntry) : new Uint8Array(readFileSync(job.file));
    const asi = job.gameDir ? join(job.gameDir, 'mssvoice.asi') : undefined;
    // The helper is a Windows program; it loads the person's own mssvoice.asi (never bundled).
    const decoder = process.platform === 'win32' && asi && existsSync(asi) && job.helperExe && existsSync(job.helperExe)
      ? helperDecoder(job.helperExe, asi)
      : undefined;
    const { bytes, report } = fixDemo(input, { halfLifeDir: job.gameDir, voiceDecoder: decoder, voiceFilter: job.cleanup ? voiceCleanup : undefined });
    mkdirSync(dirname(job.output), { recursive: true });
    writeNewFile([job.file], job.output, bytes, { overwrite: job.overwrite });
    const done: string[] = [];
    if (report.recovered) done.push('Repaired a cut-off recording.');
    if (report.converted) done.push(`Converted protocol ${report.sourceProtocol} → 48 for today's CS 1.6.`);
    if (report.voice) done.push(`Put the original voice back as Steam voice (${Math.round(report.voice.seconds / 6) / 10} min${job.cleanup ? ', voice cleanup on' : ''}).`);
    return { ok: true, output: job.output, seconds: (Date.now() - t0) / 1000, done, notes: [...report.notes] };
  } catch (err) {
    return { ok: false, error: (err as Error).message, done: [], notes: [] };
  }
}
