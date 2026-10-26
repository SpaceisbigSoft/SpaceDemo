// Originals are never changed (owner's rule, planning standards; reaffirmed 2026-10-26). Every tool that writes a
// file goes through writeNewFile(), which refuses to write over any input file — compared by the file's identity on
// disk (device + inode), so another spelling, a different letter case, a symbolic link or a hard link to the
// original cannot slip through — and refuses to replace an existing file unless the caller explicitly allows it.
// The new file is written next to its final place under a temporary name and then moved into place, so a crash
// never leaves a half-written file. Input files are only ever opened for reading.
import { closeSync, existsSync, fsyncSync, openSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class OriginalProtectedError extends Error {}

function sameFile(a: string, b: string): boolean {
  const ra = resolve(a), rb = resolve(b);
  if (ra === rb || (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase())) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  try {
    if (realpathSync(a) === realpathSync(b)) return true;
    const sa = statSync(a, { bigint: true }), sb = statSync(b, { bigint: true });
    return sa.dev === sb.dev && sa.ino === sb.ino && sa.ino !== 0n;
  } catch {
    return false;
  }
}

/** Throws if writing `output` could change one of `inputs` (or, without `overwrite`, any existing file). */
export function checkSafeOutput(inputs: string[], output: string, options: { overwrite?: boolean } = {}): void {
  for (const input of inputs) {
    if (sameFile(input, output)) throw new OriginalProtectedError(`Refusing to write over the original file ${input}. Originals are never changed; choose a different output file.`);
  }
  if (existsSync(output)) {
    if (!statSync(output).isFile()) throw new OriginalProtectedError(`${output} exists and is not a file.`);
    if (!options.overwrite) throw new OriginalProtectedError(`${output} already exists; not replacing it. Choose a new file name (or allow overwriting a previous fixed copy).`);
  }
}

/** Writes `bytes` to a new file `output`, never touching any of `inputs` (see checkSafeOutput). */
export function writeNewFile(inputs: string[], output: string, bytes: Uint8Array, options: { overwrite?: boolean } = {}): void {
  checkSafeOutput(inputs, output, options);
  const tmp = join(dirname(resolve(output)), `.${basename(output)}.${process.pid}.${Date.now()}.partial`);
  const fd = openSync(tmp, 'wx');
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    // Re-check right before the move (something may have changed while writing).
    checkSafeOutput(inputs, output, options);
    renameSync(tmp, output);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}
