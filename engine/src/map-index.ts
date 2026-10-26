// Finds the right version of a demo's map among folders of .bsp files, by engine checksum.
// Old demos need the exact map version they were recorded on; names alone are not enough
// (maps were sometimes renamed, e.g. de_clan1_mill → de_cpl_mill).
import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { mapChecksumFile } from './mapcrc.js';

export interface MapFile {
  path: string;
  /** File name without .bsp, lower case. */
  name: string;
  checksum: number;
}

export type MapMatch =
  | { status: 'ok'; file: MapFile }
  | { status: 'renamed'; file: MapFile }
  | { status: 'wrongVersion'; installed: MapFile[] }
  | { status: 'missing' };

/** Lists every readable .bsp under the given folders (recursively) with its checksum. */
export function indexMaps(folders: string[], gameDir = 'cstrike'): MapFile[] {
  const out: MapFile[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (extname(p).toLowerCase() === '.bsp') {
        try {
          out.push({ path: p, name: basename(p, extname(p)).toLowerCase(), checksum: mapChecksumFile(p, gameDir) });
        } catch {
          // Not a GoldSrc map; ignore.
        }
      }
    }
  };
  for (const f of folders) walk(f);
  return out;
}

/** Decides whether the map a demo needs is available. */
export function matchMap(maps: MapFile[], mapName: string, checksum: number): MapMatch {
  const name = mapName.toLowerCase();
  const exact = maps.find((m) => m.name === name && m.checksum === checksum);
  if (exact) return { status: 'ok', file: exact };
  const renamed = maps.find((m) => m.checksum === checksum);
  if (renamed) return { status: 'renamed', file: renamed };
  const sameName = maps.filter((m) => m.name === name);
  if (sameName.length) return { status: 'wrongVersion', installed: sameName };
  return { status: 'missing' };
}
