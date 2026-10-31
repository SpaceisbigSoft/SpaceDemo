// 5.u Aim tab: the recorder's moments, shots by weapon and round summaries (Set 1, CDF_ZIPS); HLTV demos have none.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSight } from '../../engine/src/map/sight.js';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { aimPanel } from '../main/aim.js';
import { findCandidates } from '../main/library.js';

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.u on Set 1', () => {
  const read = (name: string) => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === name)!;
    return extractMatch(readDemo(readZipEntry(c.file, c.zipEntry!)), { aim: true });
  };
  it('modTside: Endbringer\'s appearances, reactions, AK shots with the 140 u/s limit, 12 rounds', () => {
    // With the map (CDF_MAPS = folders with de_train.bsp) walls are checked; without it more enemies count as "on
    // screen" too early (behind walls), so fewer appearances end in a shot.
    const mapFile = (process.env.CDF_MAPS ?? '').split(':').filter(Boolean).map((d) => join(d, 'de_train.bsp')).find((f) => existsSync(f));
    const a = aimPanel(read('modTside'), mapFile ? readSight(new Uint8Array(readFileSync(mapFile))) : undefined)!;
    expect(a.name).toBe(':i69:Endbringer');
    expect(a.team).toBe('T');
    expect(a.method).toBe(mapFile ? 'sight' : 'view');
    expect(a.summary.engagements).toBeGreaterThan(30);
    expect(a.summary.reactions).toBeGreaterThan(mapFile ? 15 : 5);
    expect(a.summary.medianReaction).toBeGreaterThan(0.15);
    expect(a.summary.medianReaction).toBeLessThan(1.5);
    expect(a.weapons[0]).toMatchObject({ weapon: 'ak47', limit: 140 });
    expect(a.summary.accurate + a.summary.moving + a.summary.air).toBe(a.summary.shots);
    expect(a.rounds).toHaveLength(12);
    expect(new Set(a.engagements.map((e) => e.enemy)).size).toBe(5);
    expect(a.engagements.every((e) => e.enemy.endsWith('.MoD'))).toBe(true);
    expect(a.margin).toBe(0.1);
  }, 120_000);
  it('HLTV demos have no aim panel', () => {
    expect(aimPanel(read('MoD train T hltvdemo'))).toBeUndefined();
  }, 120_000);
});
