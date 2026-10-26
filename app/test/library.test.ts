// Library (plan 4.3): finding demos, merging copies, statuses, map checks, cache and the service.
// With CDF_ZIPS (folder of the Set 1 zips) and CDF_MAPS (folders of .bsp files, separated by ':'), the service is also
// run on the real demos.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../engine/src/crc32.js';
import type { DemoSummary, LibraryState } from '../shared/api.js';
import { cached, demoStatus, findCandidates, loadCache, mapStatus, mergeDuplicates, saveCache } from '../main/library.js';
import { LibraryService } from '../main/library-service.js';
import { directReader } from '../main/reader.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sd-lib-'));

/** A one-file zip (deflate), dated 2002-10-06. */
function zipWith(name: string, data: Uint8Array): Buffer {
  const date = ((2002 - 1980) << 9) | (10 << 5) | 6;
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc32(data), 14);
  lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc32(data), 16);
  ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + body.length, 16);
  return Buffer.concat([lh, n, body, ch, n, end]);
}

const info = (over: Partial<DemoSummary> = {}): DemoSummary => ({
  networkProtocol: 46, gameDir: 'cstrike', recording: 'POV', map: 'de_train', maps: ['de_train'], mapChecksum: 123,
  seconds: 100, talkBursts: 0, talkers: [], players: [], directoryOk: true, problems: [], ...over,
});

describe('finding demos', () => {
  it('finds loose demos and demos inside zips, with zip dates, and merges identical copies', () => {
    const root = tmp();
    mkdirSync(join(root, 'MoD'));
    const demo = Buffer.from('HLDEMO not really a demo');
    writeFileSync(join(root, 'MoD', 'modTside.dem'), demo);
    utimesSync(join(root, 'MoD', 'modTside.dem'), new Date('2026-10-26T12:00:00Z'), new Date('2026-10-26T12:00:00Z'));
    writeFileSync(join(root, 'MoD', 'MoD.zip'), zipWith('modTside.dem', demo));
    writeFileSync(join(root, 'other.zip'), zipWith('sub/ugpCTside.DEM', Buffer.from('xyz')));
    writeFileSync(join(root, 'notes.txt'), 'hi');
    writeFileSync(join(root, 'broken.zip'), 'not a zip');

    const { candidates, problems } = findCandidates([root, join(root, 'missing')]);
    expect(candidates.map((c) => c.key).sort()).toEqual([
      join(root, 'MoD', 'MoD.zip') + '::modTside.dem',
      join(root, 'MoD', 'modTside.dem'),
      join(root, 'other.zip') + '::sub/ugpCTside.DEM',
    ].sort());
    expect(problems.some((p) => p.includes("isn't a zip"))).toBe(true);
    expect(problems.some((p) => p.includes("can't be found"))).toBe(true);

    const rows = mergeDuplicates(candidates);
    expect(rows).toHaveLength(2);
    const mod = rows.find((r) => r.demo.name === 'modTside')!;
    expect(mod.candidate.zipEntry).toBeUndefined(); // the loose file is used
    expect(mod.demo.dateSource).toBe('zip');         // with the zip's 2002 date
    expect(new Date(mod.demo.date).getFullYear()).toBe(2002);
    expect(mod.demo.alsoAt).toEqual([`${join(root, 'MoD', 'MoD.zip')} → modTside.dem`]);
    expect(rows.find((r) => r.demo.name === 'ugpCTside')!.demo.zipEntry).toBe('sub/ugpCTside.DEM');
  });

  it('accepts single files as library entries', () => {
    const root = tmp();
    const f = join(root, 'a.dem');
    writeFileSync(f, 'x');
    expect(findCandidates([f]).candidates.map((c) => c.key)).toEqual([f]);
  });
});

describe('status and map', () => {
  it('sorts demos into statuses', () => {
    expect(demoStatus(undefined, 'bad')).toBe('unreadable');
    expect(demoStatus(undefined, undefined)).toBe('waiting');
    expect(demoStatus(info(), undefined)).toBe('needs-fix');
    expect(demoStatus(info({ networkProtocol: 48 }), undefined)).toBe('plays');
    expect(demoStatus(info({ networkProtocol: 48, directoryOk: false }), undefined)).toBe('damaged');
    expect(demoStatus(info({ gameDir: 'valve' }), undefined)).toBe('not-cs');
  });

  it('describes where the map is', () => {
    const maps = [
      { path: '/game/cstrike/maps/de_train.bsp', name: 'de_train', checksum: 123 },
      { path: '/pool/x/de_clan1_mill.bsp', name: 'de_clan1_mill', checksum: 77 },
      { path: '/game/cstrike/maps/de_nuke.bsp', name: 'de_nuke', checksum: 1 },
    ];
    expect(mapStatus(info(), maps, ['/pool'])).toEqual({ kind: 'ok', note: 'installed' });
    expect(mapStatus(info({ map: 'de_clan1_mill', mapChecksum: 77 }), maps, ['/pool'])).toEqual({ kind: 'ok', note: 'old version · map pool' });
    expect(mapStatus(info({ map: 'de_cpl_mill', mapChecksum: 77 }), maps, ['/pool'])).toEqual({ kind: 'ok', note: 'found as de_clan1_mill · map pool' });
    expect(mapStatus(info({ map: 'de_nuke', mapChecksum: 2 }), maps, ['/pool']).kind).toBe('warn');
    expect(mapStatus(info({ map: 'de_dust', mapChecksum: 5 }), maps, []).note).toBe('map missing');
    expect(mapStatus(info(), undefined, []).kind).toBe('unknown');
  });
});

describe('cache', () => {
  it('keeps results until the file changes', () => {
    const f = join(tmp(), 'cache.json');
    const c = new Map([['k', { size: 10, mtime: 5, info: info() }]]);
    saveCache(f, c);
    const back = loadCache(f);
    const cand = { key: 'k', name: 'k', file: 'k', folder: '', size: 10, mtime: 5, date: 0, dateSource: 'file' as const };
    expect(cached(back, cand)?.info?.map).toBe('de_train');
    expect(cached(back, { ...cand, mtime: 6 })).toBeUndefined();
    writeFileSync(f, '{"v": 999, "demos": {}}');
    expect(loadCache(f).size).toBe(0);
  });
});

describe('library service', () => {
  it('reads unreadable demos as such and reports progress', async () => {
    const root = tmp();
    writeFileSync(join(root, 'junk.dem'), 'not a demo');
    const states: LibraryState[] = [];
    const svc = new LibraryService({
      cacheFile: join(tmp(), 'c.json'), reader: directReader(), roots: () => [root], mapFolders: () => [],
      gameDir: () => undefined, onChange: (s) => states.push(structuredClone(s)), throttleMs: 0,
    });
    await svc.refresh();
    const last = states[states.length - 1];
    expect(last.scan).toBeUndefined();
    expect(last.demos).toHaveLength(1);
    expect(last.demos[0].status).toBe('unreadable');
    expect(states.some((s) => s.scan?.total === 1)).toBe(true);
  });

  const zips = process.env.CDF_ZIPS;
  const maps = process.env.CDF_MAPS?.split(':').filter(Boolean) ?? [];
  it.skipIf(!zips)('reads the real Set 1 demos (from zips), then serves them from the cache', async () => {
    const cacheFile = join(tmp(), 'c.json');
    let last: LibraryState | undefined;
    const make = () => new LibraryService({
      cacheFile, reader: directReader(), roots: () => [zips!], mapFolders: () => maps, gameDir: () => undefined,
      onChange: (s) => { last = s; }, throttleMs: 0,
    });
    await make().refresh();
    const demos = last!.demos;
    expect(demos).toHaveLength(27);
    expect(demos.every((d) => d.status === 'needs-fix')).toBe(true);
    expect(demos.every((d) => d.dateSource === 'zip' && new Date(d.date).getFullYear() >= 2002)).toBe(true);
    const mod = demos.find((d) => d.name === 'modTside')!;
    expect(mod.info).toMatchObject({ map: 'de_train', recording: 'POV', networkProtocol: 46, voiceCodec: 'voice_miles' });
    expect(Math.round(mod.info!.voiceSeconds! / 6) / 10).toBeCloseTo(7.7, 1);
    expect(demos.filter((d) => d.info!.talkBursts === 0).map((d) => d.name).sort()).toEqual(['MoD train CT hltvdemo', 'MoD train T hltvdemo']);
    if (maps.length) expect(demos.filter((d) => d.map?.kind !== 'ok').map((d) => d.name)).toEqual([]);

    // Second start: everything from the cache, nothing read.
    let reads = 0;
    const counting = directReader();
    const svc2 = new LibraryService({
      cacheFile, reader: { ...counting, demo: async (c) => { reads++; return counting.demo(c); } },
      roots: () => [zips!], mapFolders: () => maps, gameDir: () => undefined, onChange: (s) => { last = s; }, throttleMs: 0,
    });
    await svc2.refresh();
    expect(reads).toBe(0);
    expect(last!.demos.filter((d) => d.status === 'needs-fix')).toHaveLength(27);
  }, 300_000);
});
