// Batch fixing (plan 4.6) on real demos from their zips (CDF_ZIPS): results, library status, Stop, and files that
// aren't in the library. The zips are only read.
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixBatchState } from '../shared/api.js';
import { FixService, voiceText } from '../main/fix-service.js';
import { FixedStore } from '../main/fixed-store.js';
import { findCandidates } from '../main/library.js';
import { LibraryService } from '../main/library-service.js';
import { directReader } from '../main/reader.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sd-fix-'));

describe('voice text', () => {
  it('describes the restored voice', () => {
    expect(voiceText({ voice: { seconds: 462, bursts: 332 } }, true)).toBe('7.7 min · 332 bursts');
    expect(voiceText({}, false)).toBe('none in this demo');
    expect(voiceText({}, true)).toBe('not restored');
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('batch fixing', () => {
  async function setup() {
    const lib = tmp();
    mkdirSync(join(lib, 'MoD'));
    writeFileSync(join(lib, 'MoD', 'MoD.zip'), readFileSync(join(zips!, 'MoD', 'MoD.zip')));
    const data = tmp();
    const outDir = join(tmp(), 'Fixed demos');
    const fixed = new FixedStore(join(data, 'fixed.json'));
    const reader = directReader();
    const library = new LibraryService({
      cacheFile: join(data, 'c.json'), reader, roots: () => [lib], mapFolders: () => [], gameDir: () => undefined,
      onChange: () => {}, throttleMs: 0, fixedCopy: (k, s) => fixed.get(k, s)?.output,
    });
    await library.refresh();
    const states: FixBatchState[] = [];
    const svc = new FixService({ library, reader, fixed, gameDir: () => undefined, outputFolder: () => outDir, helperExe: '/none', onChange: (s) => states.push(s) });
    const until = async (f: () => boolean) => { for (let i = 0; i < 600 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };
    return { lib, library, svc, states, outDir, until };
  }

  it('fixes library demos one by one and marks them Fixed · ready', async () => {
    const { lib, library, svc, until, outDir } = await setup();
    const before = statSync(join(lib, 'MoD', 'MoD.zip'));
    const keys = library.state().demos.map((d) => d.key);
    expect(keys).toHaveLength(2);
    svc.addLibrary(keys);
    await until(() => !svc.state().running);
    const s = svc.state();
    expect(s.items.map((i) => [i.name, i.state, i.inLibrary])).toEqual([['modCTside', 'fixed', true], ['modTside', 'fixed', true]]);
    expect(s.items.every((i) => i.done.some((d) => d.includes('Converted protocol 46 → 48')))).toBe(true);
    expect(s.items[0].output).toBe(join(outDir, 'modCTside_fixed.dem'));
    expect(library.state().demos.every((d) => d.status === 'fixed')).toBe(true);
    const after = statSync(join(lib, 'MoD', 'MoD.zip'));
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
  }, 300_000);

  it('Stop finishes the current demo and skips the rest; files outside the library work too', async () => {
    const { svc, until } = await setup();
    const files = findCandidates([join(zips!, 'MoD', 'hltv.zip'), join(zips!, 'Mfa', 'Mfa.zip')]).candidates;
    expect(files).toHaveLength(5);
    svc.addCandidates(files);
    await until(() => svc.state().items.some((i) => i.state === 'fixing'));
    svc.stop();
    await until(() => !svc.state().running);
    const st = svc.state().items.map((i) => i.state);
    expect(st[0]).toBe('fixed');
    expect(st.filter((x) => x === 'skipped').length).toBeGreaterThanOrEqual(3);
    expect(svc.state().items.every((i) => !i.inLibrary)).toBe(true);
  }, 300_000);
});
