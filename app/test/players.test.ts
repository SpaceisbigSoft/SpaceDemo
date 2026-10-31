// 5.p player totals: fingerprints (secrets hashed), likeness, same-half detection, totals with merges (no demos);
// Set 1: totals = the sum of each counted demo's scoreboard, POV + HLTV of the same half counted once (CDF_ZIPS).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DemoPlayers } from '../shared/api.js';
import { LibraryService } from '../main/library-service.js';
import { fingerprint, likeness, playerTotals, sameHalf } from '../main/players.js';
import { PlayersService } from '../main/players-service.js';
import { directReader } from '../main/reader.js';

const fpA = fingerprint({ name: 'Bob', model: 'leet', topcolor: '30', bottomcolor: '6', rate: '9999.000000', cl_updaterate: '20', plb_pw: 'hunter2', s: '7', '*tracker': '123' });
const player = (name: string, kills: number, deaths: number, fp = fingerprint({}), tag?: string, otherNames: string[] = []) => ({
  name, team: 'T' as const, recorder: false, tag, kills, deaths, headshots: 1, teamKills: 0, suicides: 0, firstKills: 1, multi3: 0, clutches: 0, fp, otherNames,
});
const demo = (key: string, rounds: string, players: DemoPlayers['players'], recording: 'POV' | 'HLTV' = 'POV'): DemoPlayers =>
  ({ key, name: key, date: 0, map: 'de_x', recording, rounds: rounds.length, signature: `de_x|${rounds}|`, players });

describe('5.p fingerprints', () => {
  it('keeps ids and settings, hashes secrets, leaves out what changes with the team', () => {
    expect(fpA.ids).toEqual({ '*tracker': '123' });
    expect(fpA.secrets).toHaveLength(1);
    expect(JSON.stringify(fpA)).not.toContain('hunter2');
    expect(fpA.settings).toMatchObject({ topcolor: '30', bottomcolor: '6', rate: '9999', cl_updaterate: '20' });
    expect(fpA.keys).toBe('*tracker,bottomcolor,cl_updaterate,plb_pw,rate,s,topcolor');
  });
  it('scores likeness with plain-word reasons', () => {
    const same = likeness(fpA, fingerprint({ name: 'Bobby', model: 'gign', topcolor: '30', bottomcolor: '6', rate: '9999', cl_updaterate: '20', plb_pw: 'hunter2', s: '7', '*tracker': '123' }));
    expect(same.score).toBeGreaterThanOrEqual(100);
    expect(same.reasons).toContain('same tracker id');
    const other = likeness(fpA, fingerprint({ name: 'Al', topcolor: '1', bottomcolor: '2', '*tracker': '999' }));
    expect(other.score).toBeLessThan(0);
    expect(likeness(fingerprint({ topcolor: '1', bottomcolor: '1' }), fingerprint({ topcolor: '1', bottomcolor: '1' }), 'abc', 'xyz').reasons).toContain('different clan tags (abc, xyz)');
  });
});

describe('5.p totals', () => {
  const six = (pre: string) => ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => player(pre + n, 1, 1));
  it('counts the same match half once (also a partial HLTV recording)', () => {
    const pov = demo('pov', 'CCCCTTTTTTCC', [player('Bob', 10, 5), ...six('')]);
    const hltv = demo('hltv', 'CCTTTTTT', [player('Bob', 7, 3), ...six('')], 'HLTV');
    expect(sameHalf(pov, hltv)).toBe(true);
    expect(sameHalf(pov, demo('other', 'CCTTTTTT', six('x')))).toBe(false); // other players
    const v = playerTotals([hltv, pov], {}, []);
    expect(v.demos.find((d) => d.key === 'hltv')?.countedAs).toBe('pov');
    expect(v.players.find((p) => p.name === 'Bob')).toMatchObject({ demos: 1, kills: 10, deaths: 5, rounds: 12 });
  });
  it('adds merged names together and suggests renamed players, never two names from the same match', () => {
    const fpB = fingerprint({ name: 'B2', topcolor: '30', bottomcolor: '6', rate: '9999', cl_updaterate: '20', plb_pw: 'hunter2', s: '7', '*tracker': '123' });
    const d1 = demo('d1', 'CCCCCC', [player('Bob', 10, 5, fpA, 'MoD'), player('Kim', 1, 1, fpA, 'MoD')]);
    const d2 = demo('d2', 'TTTTTT', [player('Bobby', 4, 2, fpB, 'MoD')]);
    const v = playerTotals([d1, d2], {}, []);
    // Kim and Bob played the same match: not suggested even with the same settings. Bobby (other demo) is.
    const pairs = v.suggestions.map((s) => [s.a, s.b].sort().join('|'));
    expect(pairs).toContain('Bob|Bobby');
    expect(pairs).not.toContain('Bob|Kim');
    const merged = playerTotals([d1, d2], { Bobby: 'Bob' }, []);
    expect(merged.players.find((p) => p.name === 'Bob')).toMatchObject({ kills: 14, deaths: 7, demos: 2, aliases: ['Bobby'] });
    expect(merged.suggestions.map((s) => [s.a, s.b].sort().join('|'))).not.toContain('Bob|Bobby');
    expect(playerTotals([d1, d2], {}, ['Bob|Bobby']).suggestions.map((s) => [s.a, s.b].sort().join('|'))).not.toContain('Bob|Bobby');
  });
  it('suggests a rename seen while playing', () => {
    const v = playerTotals([demo('d1', 'CCCCCC', [player('New', 3, 3, fingerprint({}), undefined, ['Old'])]), demo('d2', 'TTTTTT', [player('Old', 1, 1)])], {}, []);
    expect(v.suggestions[0]).toMatchObject({ score: 200, reasons: ['renamed from Old to New while playing (d1)'] });
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.p on Set 1', () => {
  it('reads every demo once, counts each match half once, and the totals add up', async () => {
    const data = mkdtempSync(join(tmpdir(), 'sd-players-'));
    const reader = directReader();
    const library = new LibraryService({ cacheFile: join(data, 'lib.json'), reader, roots: () => [zips!], mapFolders: () => [], gameDir: () => undefined, onChange: () => {}, throttleMs: 0 });
    await library.refresh();
    const views: number[] = [];
    const svc = new PlayersService({ library, reader, cacheFile: join(data, 'players.json'), merges: () => ({}), rejected: () => [], onChange: (v) => views.push(v.players.length) });
    await svc.update();
    const v = svc.view();
    expect(v.demos).toHaveLength(27);
    expect(v.demos.filter((d) => d.countedAs).map((d) => d.name).sort()).toEqual(['MoD train CT hltvdemo', 'MoD train T hltvdemo', 'hltvctside', 'hltvtside']);
    const end = v.players.find((p) => p.name === ':i69:Endbringer')!;
    expect(end.demos).toBeGreaterThanOrEqual(20);
    // A second service with the same cache file reads nothing again.
    const again = new PlayersService({ library, reader: { ...reader, players: async () => { throw new Error('read again'); } }, cacheFile: join(data, 'players.json'), merges: () => ({}), rejected: () => [] });
    await again.update();
    expect(again.view().players.find((p) => p.name === ':i69:Endbringer')?.kills).toBe(end.kills);
  }, 600_000);
});
