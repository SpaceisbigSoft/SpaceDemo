// Watch (plan 4.5): fixed-copy records and names, and the whole fix → launch → cleanup path on a real demo from its zip
// (CDF_ZIPS), with Steam replaced by a recorder. Nothing here starts a game.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectDemo } from '../../engine/src/inspect.js';
import { findGame } from '../../engine/src/launch/steam.js';
import { FixedStore, fixedOutputPath } from '../main/fixed-store.js';
import { LibraryService } from '../main/library-service.js';
import { directReader } from '../main/reader.js';
import { WatchService } from '../main/watch-service.js';
import type { WatchProgress } from '../shared/api.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sd-watch-'));

describe('fixed copies', () => {
  it('names the copy and never takes someone else\'s file', () => {
    const dir = tmp();
    expect(fixedOutputPath(dir, 'modTside', undefined)).toEqual({ path: join(dir, 'modTside_fixed.dem'), overwrite: false });
    writeFileSync(join(dir, 'modTside_fixed.dem'), 'not ours');
    expect(fixedOutputPath(dir, 'modTside', undefined).path).toBe(join(dir, 'modTside_fixed_2.dem'));
    expect(fixedOutputPath(dir, 'modTside', join(dir, 'modTside_fixed.dem'))).toEqual({ path: join(dir, 'modTside_fixed.dem'), overwrite: true });
    expect(fixedOutputPath(dir, 'a:b?', undefined).path).toBe(join(dir, 'a_b__fixed.dem'));
  });

  it('a record counts only while the original is unchanged and the copy is still there', () => {
    const dir = tmp();
    const out = join(dir, 'x_fixed.dem');
    writeFileSync(out, '12345');
    const s = new FixedStore(join(dir, 'fixed.json'));
    s.set('k', { output: out, size: 10, mtime: 5, fixedAt: 1, outputSize: 5, done: [], notes: [] });
    const again = new FixedStore(join(dir, 'fixed.json'));
    expect(again.get('k', { size: 10, mtime: 5 })?.output).toBe(out);
    expect(again.get('k', { size: 10, mtime: 6 })).toBeUndefined();
    writeFileSync(out, 'changed!');
    expect(again.get('k', { size: 10, mtime: 5 })).toBeUndefined();
    expect(again.ownOutput('k')).toBe(out);
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('watch a real demo', () => {
  it('fixes modTside from its zip, launches it with viewdemo and tidies up', async () => {
    // A stand-in game folder (hl.exe + cstrike) and output folder.
    const game = join(tmp(), 'Half-Life');
    mkdirSync(join(game, 'cstrike'), { recursive: true });
    writeFileSync(join(game, 'hl.exe'), '');
    writeFileSync(join(game, 'cstrike', 'liblist.gam'), 'game "Counter-Strike"\n');
    const outDir = join(tmp(), 'Fixed demos');
    const data = tmp();
    const zipOnly = tmp();
    mkdirSync(join(zipOnly, 'MoD'));
    writeFileSync(join(zipOnly, 'MoD', 'MoD.zip'), readFileSync(join(zips!, 'MoD', 'MoD.zip')));
    const zipBefore = statSync(join(zipOnly, 'MoD', 'MoD.zip'));

    const fixed = new FixedStore(join(data, 'fixed.json'));
    const reader = directReader();
    const library = new LibraryService({
      cacheFile: join(data, 'cache.json'), reader, roots: () => [zipOnly], mapFolders: () => [], gameDir: () => game,
      onChange: () => {}, throttleMs: 0, fixedCopy: (k, s) => fixed.get(k, s)?.output,
    });
    await library.refresh();
    const key = library.state().demos.find((d) => d.name === 'modTside')!.key;

    const started: string[][] = [];
    const progress: WatchProgress[] = [];
    let running = false;
    const findRaw = () => { const f = findGame({ gameDir: game }); f.steam = { dir: '/steam', exe: '/steam/steam.exe', source: 'manual' }; return f; };
    const watch = new WatchService({
      library, reader, fixed, findGame: findRaw, outputFolder: () => outDir, helperExe: '/none.exe',
      onProgress: (p) => progress.push(p), start: (_exe, args) => { started.push(args); running = true; },
      gameRunning: () => running, sleep: async () => { running = false; },
    });

    const info = watch.info(key);
    expect(info).toMatchObject({ mode: 'viewdemo', needsFix: true, problems: [] });
    const p = await watch.watch(key);
    expect(p.stage).toBe('playing');
    expect(progress.map((x) => x.stage).slice(0, 3)).toEqual(['fixing', 'starting', 'playing']);

    // The fixed copy: new file, protocol 48; the zip is untouched.
    const out = join(outDir, 'modTside_fixed.dem');
    expect(inspectDemo(new Uint8Array(readFileSync(out))).networkProtocol).toBe(48);
    const zipAfter = statSync(join(zipOnly, 'MoD', 'MoD.zip'));
    expect([zipAfter.size, zipAfter.mtimeMs]).toEqual([zipBefore.size, zipBefore.mtimeMs]);
    expect(library.state().demos.find((d) => d.key === key)).toMatchObject({ status: 'fixed', fixedCopy: out });

    // Steam was asked for exactly this, and the copy went into our own cdf_test folder.
    expect(started).toEqual([['-applaunch', '10', '-insecure', '+viewdemo', 'cdf_test/modTside_fixed']]);
    // When the game closes, our copy is removed again.
    await expect.poll(() => progress.some((x) => x.stage === 'done'), { timeout: 10_000 }).toBe(true);
    expect(readdirSync(join(game, 'cstrike', 'cdf_test')).filter((f) => f.endsWith('.dem'))).toEqual([]);

    // Second time: no fixing, the same copy is used.
    expect(watch.info(key)).toMatchObject({ needsFix: false, fixedCopy: out });
    progress.length = 0;
    await watch.watch(key);
    expect(progress[0].stage).toBe('starting');
    expect(existsSync(join(outDir, 'modTside_fixed_2.dem'))).toBe(false);
  }, 300_000);
});
