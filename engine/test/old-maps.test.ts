// 0.8 old maps for playback: planning (present / install renamed / install under its own name / missing), WAD handling
// and that nothing in the game's own folders is changed. Uses real old maps from CDF_MAPS when given (Old Maps pool:
// de_nuke 127948090 lists jos.wad and keeps its textures outside; de_clan1_mill keeps all textures inside).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoMapOf, installOldMap, mapWads, oldMapName, planOldMap, usesOutsideTextures, withoutWads } from '../src/launch/old-maps.js';
import { indexMaps } from '../src/map-index.js';
import { mapChecksum } from '../src/mapcrc.js';

describe('old map names and demo header', () => {
  it('names a renamed old map <name>_<checksum hex>', () => {
    expect(oldMapName('de_nuke', 127948090)).toBe('de_nuke_7a0553a');
    expect(oldMapName('DE_CBBLE', 3163797097)).toBe('de_cbble_bc93b669');
  });
  it('reads map name and checksum from a demo header', () => {
    const h = new Uint8Array(544);
    h.set(new TextEncoder().encode('de_nuke'), 16);
    new DataView(h.buffer).setUint32(536, 127948090, true);
    expect(demoMapOf(h)).toEqual({ name: 'de_nuke', checksum: 127948090 });
  });
});

const mapDirs = (process.env.CDF_MAPS ?? '').split(/[:;]/).filter(Boolean);
const pool = mapDirs.length ? indexMaps(mapDirs) : [];
const nuke = pool.find((m) => m.checksum === 127948090);
const mill = pool.find((m) => m.checksum === 1979151874);

/** A stand-in game folder: cstrike/maps/de_nuke.bsp = a different version (any other map file will do). */
function fakeGame(stockNuke?: string): string {
  const g = mkdtempSync(join(tmpdir(), 'oldmaps-'));
  mkdirSync(join(g, 'cstrike', 'maps'), { recursive: true });
  mkdirSync(join(g, 'valve'), { recursive: true });
  for (const w of ['halflife.wad', 'decals.wad', 'cstrike.wad', 'cs_bdog.wad']) writeFileSync(join(g, w.startsWith('halflife') ? 'valve' : 'cstrike', w), '');
  if (stockNuke) cpSync(stockNuke, join(g, 'cstrike', 'maps', 'de_nuke.bsp'));
  return g;
}
const snapshot = (dir: string) => {
  const out: Record<string, number> = {};
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out[p] = statSync(p).size; } };
  walk(dir);
  return out;
};

describe.skipIf(!nuke || !mill)('old maps with the real Old Maps pool (CDF_MAPS)', () => {
  it('de_nuke: textures outside, lists jos.wad; dropping a WAD keeps the checksum', () => {
    const b = new Uint8Array(readFileSync(nuke!.path));
    expect(usesOutsideTextures(b)).toBe(true);
    expect(mapWads(b).map((w) => w.toLowerCase())).toContain('jos.wad');
    const out = withoutWads(b, ['jos.wad']);
    expect(mapWads(out).map((w) => w.toLowerCase())).not.toContain('jos.wad');
    expect(mapWads(out).length).toBe(mapWads(b).length - 1);
    expect(mapChecksum(Buffer.from(out))).toBe(127948090);
    expect(usesOutsideTextures(new Uint8Array(readFileSync(mill!.path)))).toBe(false);
  });

  it('stock name taken by another version → renamed copy in cstrike_downloads + jos.wad from next to the map; stock untouched', () => {
    const other = pool.find((m) => m.checksum !== 127948090)!;
    const g = fakeGame(other.path);
    const before = snapshot(join(g, 'cstrike'));
    const plan = planOldMap('de_nuke', 127948090, g, pool);
    expect(plan).toMatchObject({ kind: 'install', installName: 'de_nuke_7a0553a', rename: true });
    if (plan.kind !== 'install') return;
    const r = installOldMap(g, plan);
    expect(r.path).toBe(join(g, 'cstrike_downloads', 'maps', 'de_nuke_7a0553a.bsp'));
    expect(mapChecksum(readFileSync(r.path))).toBe(127948090);
    expect(existsSync(join(g, 'cstrike_downloads', 'jos.wad'))).toBe(existsSync(join(nuke!.path, '..', 'jos.wad')));
    expect(snapshot(join(g, 'cstrike'))).toEqual(before);
    // Second time: the copy is found and reused.
    expect(planOldMap('de_nuke', 127948090, g, [])).toMatchObject({ kind: 'install', installName: 'de_nuke_7a0553a' });
    expect(installOldMap(g, planOldMap('de_nuke', 127948090, g, []) as never).done).toEqual([]);
  });

  it('a WAD that is nowhere is left out of the copy (with a note) instead of stopping the game', () => {
    const g = fakeGame();
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    cpSync(nuke!.path, join(dir, 'de_nuke.bsp')); // no jos.wad next to it
    const plan = planOldMap('de_nuke', 127948090, g, [dir]);
    expect(plan).toMatchObject({ kind: 'install', installName: 'de_nuke', rename: false }); // name free in this game
    if (plan.kind !== 'install') return;
    const r = installOldMap(g, plan);
    expect(r.notes.join(' ')).toMatch(/jos\.wad/);
    expect(mapWads(new Uint8Array(readFileSync(r.path))).map((w) => w.toLowerCase())).not.toContain('jos.wad');
    expect(mapChecksum(readFileSync(r.path))).toBe(127948090);
  });

  it('de_clan1_mill keeps its own name when the game has none; the right stock version needs nothing; unknown = missing', () => {
    const g = fakeGame();
    expect(planOldMap('de_clan1_mill', 1979151874, g, pool)).toMatchObject({ kind: 'install', installName: 'de_clan1_mill', rename: false });
    cpSync(nuke!.path, join(g, 'cstrike', 'maps', 'de_nuke.bsp'));
    expect(planOldMap('de_nuke', 127948090, g, pool)).toEqual({ kind: 'present', name: 'de_nuke' });
    expect(planOldMap('de_nuke', 12345, g, pool)).toMatchObject({ kind: 'missing', otherVersion: true });
    expect(planOldMap('de_nowhere', 12345, g, pool)).toMatchObject({ kind: 'missing', otherVersion: false });
  });

  it('never overwrites a different map that already has the name', () => {
    const g = fakeGame();
    mkdirSync(join(g, 'cstrike_downloads', 'maps'), { recursive: true });
    cpSync(nuke!.path, join(g, 'cstrike_downloads', 'maps', 'de_clan1_mill.bsp')); // a downloaded map with that name
    const plan = planOldMap('de_clan1_mill', 1979151874, g, pool);
    expect(plan).toMatchObject({ kind: 'install', installName: 'de_clan1_mill_75f77602', rename: true });
  });
});

describe('findWad (4.11): texture files for old maps', () => {
  it('looks next to the map first, then in the old-map folders and their subfolders, ignoring case', async () => {
    const { findWad } = await import('../src/launch/old-maps.js');
    const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'wads-'));
    const mapDir = join(root, 'maps-a'), lab = join(root, 'lab'), cs10 = join(lab, 'CS10');
    for (const d of [mapDir, cs10]) mkdirSync(d, { recursive: true });
    writeFileSync(join(mapDir, 'de_vegas.bsp'), '');
    writeFileSync(join(cs10, 'de_vegas.wad'), 'x');
    writeFileSync(join(mapDir, 'JOS.WAD'), 'x');
    expect(findWad('jos.wad', join(mapDir, 'de_vegas.bsp'), [lab])).toBe(join(mapDir, 'JOS.WAD'));
    expect(findWad('de_vegas.wad', join(mapDir, 'de_vegas.bsp'), [lab])).toBe(join(cs10, 'de_vegas.wad'));
    expect(findWad('de_vegas.wad', join(mapDir, 'de_vegas.bsp'))).toBeUndefined();
    expect(findWad('itsItaly.wad', join(mapDir, 'de_vegas.bsp'), [lab, join(root, 'gone')])).toBeUndefined();
  });
});
