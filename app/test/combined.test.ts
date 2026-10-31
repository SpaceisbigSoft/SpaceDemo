// 5.r Combine demos of the same match: the library finds other recordings of a demo's match, lines them up and adds
// their positions; the other half completes the score (Set 1, CDF_ZIPS).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryService } from '../main/library-service.js';
import { directReader } from '../main/reader.js';

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.r on Set 1', () => {
  it('finds the MoD recordings, lines them up within 0.5 s, completes the score and fills the radar', async () => {
    const data = mkdtempSync(join(tmpdir(), 'sd-combined-'));
    const reader = directReader();
    const library = new LibraryService({ cacheFile: join(data, 'lib.json'), reader, roots: () => [zips!], mapFolders: () => [], gameDir: () => undefined, onChange: () => {}, throttleMs: 0 });
    await library.refresh();
    const key = (name: string) => library.state().demos.find((d) => d.name === name)!.key;

    // Candidates: same map version, close in time, same players (the other MoD demos only; reading decides).
    expect(library.companions(key('modTside')).map((c) => c.name).sort()).toEqual(['MoD train', 'MoD train CT hltvdemo', 'MoD train T hltvdemo', 'modCTside']);

    const c = await library.combined(key('modTside'));
    if ('error' in c) throw new Error(c.error);
    const same = c.recordings.filter((r) => r.relation === 'same-half');
    expect(same.map((r) => r.name)).toEqual(['MoD train T hltvdemo']);
    expect(same[0].killsLinedUp).toBe(78);
    expect(same[0].maxGap).toBeLessThanOrEqual(0.5);
    expect(c.recordings.filter((r) => r.relation === 'other-half').map((r) => r.name).sort()).toEqual(['MoD train CT hltvdemo', 'modCTside']);
    expect(c.fullMatch?.rounds).toBe(24);
    expect(c.fullMatch?.teams.map((t) => `${t.tag} ${t.halves.join('+')}=${t.rounds}`)).toEqual(['i69 6+11=17', 'MoD 6+1=7']);
    expect(c.coverage!.before).toBeLessThan(0.7);
    expect(c.coverage!.after).toBeGreaterThan(0.95);
    // Every kill now has the killer's position.
    expect(c.heatmap!.kills.filter((k) => k.kx !== undefined).length).toBe(c.heatmap!.kills.length);

    // The radar replay with the other recording: more players placed by sight.
    const alone = await library.replay(key('modTside'), 5, false);
    const both = await library.replay(key('modTside'), 5, true);
    if ('error' in alone || 'error' in both) throw new Error('replay');
    const seen = (r: typeof alone) => r.players.reduce((n, p) => n + p.seen.length / 5, 0);
    expect(seen(both)).toBeGreaterThan(1.5 * seen(alone));

    // Asking again uses what was combined (nothing read again).
    const again = await library.combined(key('modTside'));
    expect(again).toBe(c);

    // A demo of another match: nothing in common with MoD.
    const other = await library.combined(key('forsakenTside'));
    if ('error' in other) throw new Error(other.error);
    expect(other.recordings.every((r) => r.relation === 'other-half')).toBe(true);
  }, 600_000);
});
