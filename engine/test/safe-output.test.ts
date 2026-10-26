import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkSafeOutput, OriginalProtectedError, writeNewFile } from '../src/fix/safe-output.js';
import { fixtureDemos } from './fixtures.js';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('originals are never changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdf-safe-'));
  const original = join(dir, 'old.dem');
  writeFileSync(original, 'ORIGINAL');
  const before = sha(original);

  it('refuses the same path, another spelling, a symbolic link and a hard link to the original', () => {
    const sym = join(dir, 'link.dem'), hard = join(dir, 'hard.dem');
    symlinkSync(original, sym);
    linkSync(original, hard);
    for (const out of [original, join(dir, '.', 'old.dem'), join(dir, 'sub', '..', 'old.dem'), sym, hard]) {
      expect(() => writeNewFile([original], out, new Uint8Array([1]))).toThrow(OriginalProtectedError);
      // even when overwriting is allowed
      expect(() => writeNewFile([original], out, new Uint8Array([1]), { overwrite: true })).toThrow(OriginalProtectedError);
    }
    expect(sha(original)).toBe(before);
  });
  it('does not replace an existing file unless allowed (and then never an input)', () => {
    const out = join(dir, 'fixed.dem');
    writeNewFile([original], out, new Uint8Array([1, 2]));
    expect(() => writeNewFile([original], out, new Uint8Array([3]))).toThrow(/already exists/);
    writeNewFile([original], out, new Uint8Array([3]), { overwrite: true });
    expect([...readFileSync(out)]).toEqual([3]);
    expect(sha(original)).toBe(before);
    expect(() => checkSafeOutput([original, out], out, { overwrite: true })).toThrow(OriginalProtectedError);
  });
  it('leaves no half-written files behind', () => {
    expect(readdirSync(dir).filter((f) => f.endsWith('.partial'))).toEqual([]);
  });
});

// The real command on a real demo: the original file is byte-for-byte unchanged, and writing over it is refused.
const demo = fixtureDemos().find((d) => /ugpCTside\.dem$/i.test(d));
describe.skipIf(!demo)('npm run fix leaves the original untouched', () => {
  it('fix and convert refuse to write over the original; a normal fix keeps it identical', () => {
    const before = sha(demo!);
    const run = (args: string[]) => spawnSync('npx', ['tsx', ...args], { encoding: 'utf8' });
    const same = run(['tools/fix.ts', demo!, demo!]);
    expect(same.status).not.toBe(0);
    expect(same.stderr + same.stdout).toMatch(/Refusing to write over the original/);
    expect(run(['tools/convert.ts', demo!, demo!]).status).not.toBe(0);
    const out = join(mkdtempSync(join(tmpdir(), 'cdf-fix-')), 'fixed.dem');
    const ok = run(['tools/fix.ts', demo!, out]);
    expect(ok.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(sha(demo!)).toBe(before);
  }, 120_000);
});
