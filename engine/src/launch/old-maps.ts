// Old map versions for playback (plan 0.8). A demo needs the exact map version it was recorded on (same checksum).
// Today's game has newer maps under the same names (de_nuke, de_cbble, de_inferno), and stock files are never
// replaced (anti-cheat safety rule). So an old map is copied into <game>\cstrike_downloads\maps — the folder the game
// uses for maps downloaded from servers — under a new name ("de_nuke_7a0553a") when its own name is taken, and the
// fixed demo is told that name (UpgradeOptions.mapName; the checksum doesn't include the name).
// Owner's in-game test 2026-11-01: de_nuke, de_cbble, de_inferno (renamed) and de_clan1_mill all load and play.
// A map that lists a texture file (WAD) the game can't find stops the game ("couldn't open jos.wad") when the map keeps
// any textures outside itself; so missing WADs are copied from next to the old map, or else dropped from the copy's
// list (the entities lump, which the checksum skips).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { indexMaps, matchMap, type MapFile } from '../map-index.js';
import { mapChecksum } from '../mapcrc.js';

export type OldMapPlan =
  /** The game already has this exact map (stock or in cstrike_downloads): nothing to do. */
  | { kind: 'present'; name: string }
  /** Copy `source` to cstrike_downloads\maps\<installName>.bsp; `rename` = the demo must use installName. */
  | { kind: 'install'; source: string; installName: string; rename: boolean }
  /** No copy of this map version anywhere (game or map folders). */
  | { kind: 'missing'; name: string; checksum: number; otherVersion: boolean };

/** The name an old map gets when its own name is taken by another version: "<name>_<checksum in hex>". */
export function oldMapName(name: string, checksum: number): string {
  return `${name.toLowerCase()}_${(checksum >>> 0).toString(16)}`;
}

/** Map name and checksum from a demo's header (bytes 16–275 and 536). */
export function demoMapOf(demo: Uint8Array): { name: string; checksum: number } {
  const field = demo.subarray(16, 276);
  const end = field.indexOf(0);
  const name = new TextDecoder('latin1').decode(end < 0 ? field : field.subarray(0, end)).replace(/\.bsp$/i, '');
  return { name, checksum: new DataView(demo.buffer, demo.byteOffset, demo.byteLength).getUint32(536, true) };
}

const checksumOf = (path: string): number | undefined => {
  try {
    return mapChecksum(readFileSync(path));
  } catch {
    return undefined;
  }
};

/** Decides what a demo on map `name` / `checksum` needs. `maps` = indexMaps(map folders), or the folders themselves. */
export function planOldMap(name: string, checksum: number, gameDir: string, maps: MapFile[] | string[]): OldMapPlan {
  const lower = name.toLowerCase();
  const stock = join(gameDir, 'cstrike', 'maps', `${lower}.bsp`);
  const downloads = join(gameDir, 'cstrike_downloads', 'maps');
  const stockSum = existsSync(stock) ? checksumOf(stock) : undefined;
  if (stockSum === checksum) return { kind: 'present', name: lower };
  const ownSum = existsSync(join(downloads, `${lower}.bsp`)) ? checksumOf(join(downloads, `${lower}.bsp`)) : undefined;
  if (stockSum === undefined && ownSum === checksum) return { kind: 'present', name: lower };
  // Our renamed copy from an earlier fix.
  const renamed = oldMapName(lower, checksum);
  if (existsSync(join(downloads, `${renamed}.bsp`)) && checksumOf(join(downloads, `${renamed}.bsp`)) === checksum) {
    return { kind: 'install', source: join(downloads, `${renamed}.bsp`), installName: renamed, rename: true };
  }
  const files = maps.length && typeof maps[0] === 'string' ? indexMaps(maps as string[]) : (maps as MapFile[]);
  const m = matchMap(files, lower, checksum);
  if (m.status !== 'ok' && m.status !== 'renamed') return { kind: 'missing', name: lower, checksum, otherVersion: stockSum !== undefined || ownSum !== undefined };
  // Keep the map's own name only when nothing in the game uses it (e.g. de_clan1_mill); never overwrite anything.
  const nameFree = stockSum === undefined && ownSum === undefined;
  return nameFree
    ? { kind: 'install', source: m.file.path, installName: lower, rename: false }
    : { kind: 'install', source: m.file.path, installName: renamed, rename: true };
}

/** Texture files (WADs) a map lists in its worldspawn "wad" key, as bare file names. */
export function mapWads(bsp: Uint8Array): string[] {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4, true), len = v.getInt32(8, true);
  const text = new TextDecoder('latin1').decode(bsp.subarray(ofs, ofs + len));
  const m = /"wad"\s+"([^"]*)"/i.exec(text);
  return m ? m[1].split(';').map((w) => w.trim().split(/[\\/]/).pop()!).filter(Boolean) : [];
}

/** True when the map keeps some textures outside itself (only then does the game open the listed WADs). */
export function usesOutsideTextures(bsp: Uint8Array): boolean {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4 + 2 * 8, true);
  const n = v.getInt32(ofs, true);
  for (let i = 0; i < n; i++) {
    const o = v.getInt32(ofs + 4 + 4 * i, true);
    if (o < 0) continue;
    if (v.getUint32(ofs + o + 24, true) === 0) return true;
  }
  return false;
}

/** A copy of the map with these WADs taken out of its list (entities lump moved to the end; checksum unchanged). */
export function withoutWads(bsp: Uint8Array, drop: string[]): Uint8Array {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4, true), len = v.getInt32(8, true);
  const text = new TextDecoder('latin1').decode(bsp.subarray(ofs, ofs + len));
  const gone = new Set(drop.map((d) => d.toLowerCase()));
  const next = text.replace(/("wad"\s+")([^"]*)(")/i, (_, a: string, list: string, c: string) =>
    a + list.split(';').filter((w) => w && !gone.has(w.trim().split(/[\\/]/).pop()!.toLowerCase())).join(';') + (list.endsWith(';') ? ';' : '') + c);
  const ent = Uint8Array.from(next, (ch) => ch.charCodeAt(0) & 0xff);
  const at = (bsp.length + 3) & ~3;
  const out = new Uint8Array(at + ent.length);
  out.set(bsp);
  out.set(ent, at);
  const ov = new DataView(out.buffer);
  ov.setInt32(4, at, true);
  ov.setInt32(8, ent.length, true);
  return out;
}

export interface InstallResult {
  /** Path of the map in cstrike_downloads\maps. */
  path: string;
  /** What was done, in plain words (empty when the map was already there). */
  done: string[];
  /** Problems the person may notice. */
  notes: string[];
}

/** Puts an old map in place for `install` plans (copy + missing WADs). Never touches stock files or overwrites others'. */
export function installOldMap(gameDir: string, plan: Extract<OldMapPlan, { kind: 'install' }>): InstallResult {
  const downloads = join(gameDir, 'cstrike_downloads');
  const dest = join(downloads, 'maps', `${plan.installName}.bsp`);
  const done: string[] = [], notes: string[] = [];
  let bsp = new Uint8Array(readFileSync(plan.source));
  const want = mapChecksum(Buffer.from(bsp));
  const wadFound = (w: string) => ['cstrike', 'valve', 'cstrike_downloads'].some((d) => existsSync(join(gameDir, d, w)));
  const missing: string[] = [];
  if (usesOutsideTextures(bsp)) {
    for (const w of mapWads(bsp)) {
      if (wadFound(w)) continue;
      const nextTo = join(dirname(plan.source), w);
      if (existsSync(nextTo)) {
        mkdirSync(downloads, { recursive: true });
        copyFileSync(nextTo, join(downloads, w));
        done.push(`Added the texture file ${w} (it came with the old map).`);
      } else missing.push(w);
    }
  }
  if (missing.length) {
    bsp = withoutWads(bsp, missing);
    notes.push(`The old map lists texture file${missing.length > 1 ? 's' : ''} ${missing.join(', ')} that ${missing.length > 1 ? "aren't" : "isn't"} available; ${missing.length > 1 ? 'they were' : 'it was'} left out (a few surfaces may look plain).`);
  }
  if (existsSync(dest)) {
    const have = checksumOf(dest);
    if (have !== want) throw new Error(`${basename(dest)} in cstrike_downloads\\maps is a different map; it was left alone.`);
    if (statSync(dest).size === bsp.length) return { path: dest, done, notes };
    if (!missing.length) return { path: dest, done, notes };
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bsp);
  done.push(`Put the old map version in place as ${plan.installName} (cstrike_downloads\\maps; the game's own map is untouched).`);
  return { path: dest, done, notes };
}
