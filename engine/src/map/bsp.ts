// Read-only facts from a GoldSrc map (.bsp, version 30): entities and brush-model bounds (plan 2.14).
// Map files are only read, never changed or bundled.

export interface BspEntity {
  classname: string;
  props: Record<string, string>;
}

export interface BombSite {
  /** 1-based in map order (order of the first trigger piece in the map's entity list). */
  index: number;
  /**
   * Site letter. GoldSrc maps don't store one; we use Valve's rule from its later games: the first bomb target in the
   * map file is A, the next B (and so on). A per-map-version correction can override it (SITE_LETTER_OVERRIDES).
   */
  letter: string;
  /** Area as an axis-aligned box. info_bomb_target (a point) gets a box of ±BOMB_TARGET_RADIUS around it. */
  mins: [number, number, number];
  maxs: [number, number, number];
  source: 'func_bomb_target' | 'info_bomb_target';
}

export interface MapFacts {
  entities: BspEntity[];
  bombSites: BombSite[];
  /** Counter-terrorist (info_player_start) and terrorist (info_player_deathmatch) spawn points. */
  spawnsCT: [number, number, number][];
  spawnsT: [number, number, number][];
}

const LUMP_ENTITIES = 0;
const LUMP_MODELS = 14;
/** info_bomb_target is a point; the game allows planting near it. Box half-size used for "inside the site". */
export const BOMB_TARGET_RADIUS = 256;

function lump(bsp: Uint8Array, i: number): Uint8Array {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4 + i * 8, true);
  const len = v.getInt32(8 + i * 8, true);
  return bsp.subarray(ofs, ofs + len);
}

/** Parses the entities lump: { "key" "value" ... } blocks. */
export function parseEntities(text: string): BspEntity[] {
  const out: BspEntity[] = [];
  const blockRe = /\{([^}]*)\}/g;
  let b: RegExpExecArray | null;
  while ((b = blockRe.exec(text))) {
    const props: Record<string, string> = {};
    const kv = /"([^"]*)"\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = kv.exec(b[1]))) props[m[1]] = m[2];
    out.push({ classname: props.classname ?? '', props });
  }
  return out;
}

const vec = (s: string | undefined): [number, number, number] => {
  const p = (s ?? '0 0 0').trim().split(/\s+/).map(Number);
  return [p[0] || 0, p[1] || 0, p[2] || 0];
};

/**
 * Corrections to the default site letters, per map version ("<map>:<checksum>" → letters in map order), when the
 * community name of a site differs from the map-file order (plan 2.14; the owner checks the previews).
 */
export const SITE_LETTER_OVERRIDES: Record<string, string[]> = {
  // 2002 de_inferno (Set 1): the map file lists the north site (end of the long lane from the T side, usually called
  // "banana") first; players call that site B. Claude's call 2026-10-26, owner to confirm on the preview.
  'de_inferno:3890491249': ['B', 'A'],
};

/** Applies a correction from SITE_LETTER_OVERRIDES (or a given list) to the sites' letters. */
export function applySiteLetters(sites: BombSite[], mapName: string, checksum: number, letters = SITE_LETTER_OVERRIDES[`${mapName.toLowerCase()}:${checksum}`]): BombSite[] {
  if (!letters || letters.length !== sites.length) return sites;
  return sites.map((s, i) => ({ ...s, letter: letters[i] }));
}

export function readMapFacts(bsp: Uint8Array): MapFacts {
  const version = new DataView(bsp.buffer, bsp.byteOffset).getInt32(0, true);
  if (version !== 30) throw new Error(`Not a GoldSrc map (BSP version ${version})`);
  const entText = new TextDecoder('latin1').decode(lump(bsp, LUMP_ENTITIES)).replace(/\0+$/, '');
  const entities = parseEntities(entText);
  const models = lump(bsp, LUMP_MODELS);
  const mv = new DataView(models.buffer, models.byteOffset, models.byteLength);
  const modelBounds = (n: number): [[number, number, number], [number, number, number]] | undefined => {
    const o = n * 64; // dmodel_t: mins[3], maxs[3], origin[3], headnode[4], visleafs, firstface, numfaces
    if (o + 24 > models.length) return undefined;
    const f = (k: number) => mv.getFloat32(o + k * 4, true);
    return [[f(0), f(1), f(2)], [f(3), f(4), f(5)]];
  };
  const bombSites: BombSite[] = [];
  for (const e of entities) {
    if (e.classname === 'func_bomb_target') {
      const n = Number((e.props.model ?? '').replace('*', ''));
      const b = Number.isFinite(n) ? modelBounds(n) : undefined;
      if (b) bombSites.push({ index: bombSites.length + 1, letter: '', mins: b[0], maxs: b[1], source: 'func_bomb_target' });
    } else if (e.classname === 'info_bomb_target') {
      const o = vec(e.props.origin);
      const r = BOMB_TARGET_RADIUS;
      bombSites.push({ index: bombSites.length + 1, letter: '', mins: [o[0] - r, o[1] - r, o[2] - r], maxs: [o[0] + r, o[1] + r, o[2] + r], source: 'info_bomb_target' });
    }
  }
  return {
    entities,
    bombSites: mergeSites(bombSites),
    spawnsCT: entities.filter((e) => e.classname === 'info_player_start').map((e) => vec(e.props.origin)),
    spawnsT: entities.filter((e) => e.classname === 'info_player_deathmatch').map((e) => vec(e.props.origin)),
  };
}

/** Joins trigger pieces that touch or overlap (some maps build one site from several brushes, e.g. de_prodigy). */
function mergeSites(sites: BombSite[], gap = 64): BombSite[] {
  const out: BombSite[] = [];
  const near = (a: BombSite, b: BombSite) =>
    [0, 1, 2].every((i) => a.mins[i] - gap <= b.maxs[i] && b.mins[i] - gap <= a.maxs[i]);
  for (const s of sites) {
    let merged = { ...s, mins: [...s.mins] as BombSite['mins'], maxs: [...s.maxs] as BombSite['maxs'] };
    for (let i = out.length - 1; i >= 0; i--) {
      if (!near(out[i], merged)) continue;
      const o = out.splice(i, 1)[0];
      merged = { ...merged, index: Math.min(o.index, merged.index), mins: [0, 1, 2].map((k) => Math.min(o.mins[k], merged.mins[k])) as BombSite['mins'], maxs: [0, 1, 2].map((k) => Math.max(o.maxs[k], merged.maxs[k])) as BombSite['maxs'] };
    }
    out.push(merged);
  }
  // Keep map-file order (joining pieces must not reorder the sites: the order decides the letters).
  return out.sort((a, b) => a.index - b.index).map((s, i) => ({ ...s, index: i + 1, letter: String.fromCharCode(65 + i) }));
}

/**
 * Which bomb site (1-based) contains a point. Uses height too: on some maps the sites are stacked (de_nuke: A upstairs,
 * B in the basement). The margin allows for the bomb sitting just outside the trigger brush.
 */
export function siteAt(sites: BombSite[], p: [number, number, number], margin = 64): number | undefined {
  for (const s of sites) {
    const inXY = p[0] >= s.mins[0] - margin && p[0] <= s.maxs[0] + margin && p[1] >= s.mins[1] - margin && p[1] <= s.maxs[1] + margin;
    const inZ = p[2] >= s.mins[2] - margin && p[2] <= s.maxs[2] + 2 * margin;
    if (inXY && inZ) return s.index;
  }
  return undefined;
}

/** A walkable-looking surface (upward-facing face) as a polygon in world coordinates, for drawing a top-down map. */
export interface FloorPolygon {
  points: [number, number, number][];
}

const LUMP_PLANES = 1, LUMP_VERTICES = 3, LUMP_FACES = 7, LUMP_EDGES = 12, LUMP_SURFEDGES = 13;

export interface FloorOptions {
  /** Minimum z of the face normal (0.7 ≈ slopes players can walk on). */
  minUp?: number;
  /** Keep only faces whose average height is in this range (removes roofs and wall tops above the play area). */
  minZ?: number;
  maxZ?: number;
}

/** A player's origin is this far above the floor they stand on. */
export const PLAYER_ORIGIN_HEIGHT = 36;

/** Floor height range from player positions (e.g. tracks): the lowest and the 99.5th-percentile origin, minus 36, ±24. */
export function floorRangeFromPositions(z: number[]): { minZ: number; maxZ: number } | undefined {
  const s = z.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  return { minZ: s[0] - PLAYER_ORIGIN_HEIGHT - 24, maxZ: s[Math.floor(s.length * 0.995)] - PLAYER_ORIGIN_HEIGHT + 24 };
}

/**
 * Upward-facing faces of the world model (model 0), for maps without a matching overview image (plan 2.14 fallback).
 * Pass a height range (see `floorRangeFromPositions`) to leave out roofs; checked on the 2002 de_cbble and de_prodigy:
 * 99 % of player positions lie over a kept floor polygon.
 */
export function readFloorPolygons(bsp: Uint8Array, options: FloorOptions = {}): FloorPolygon[] {
  const minUp = options.minUp ?? 0.7;
  const dv = (l: Uint8Array) => new DataView(l.buffer, l.byteOffset, l.byteLength);
  const planes = dv(lump(bsp, LUMP_PLANES)), verts = dv(lump(bsp, LUMP_VERTICES)), faces = dv(lump(bsp, LUMP_FACES));
  const edges = dv(lump(bsp, LUMP_EDGES)), surf = dv(lump(bsp, LUMP_SURFEDGES)), models = dv(lump(bsp, LUMP_MODELS));
  const firstFace = models.getInt32(56, true), numFaces = models.getInt32(60, true); // model 0 = the world
  const out: FloorPolygon[] = [];
  for (let f = firstFace; f < firstFace + numFaces; f++) {
    const o = f * 20; // dface_t: plane u16, side u16, firstedge i32, numedges u16, texinfo u16, styles[4], lightofs i32
    const plane = faces.getUint16(o, true), side = faces.getUint16(o + 2, true);
    const firstEdge = faces.getInt32(o + 4, true), numEdges = faces.getUint16(o + 8, true);
    let nz = planes.getFloat32(plane * 20 + 8, true); // dplane_t: normal[3], dist, type
    if (side) nz = -nz;
    if (nz < minUp) continue;
    const points: [number, number, number][] = [];
    for (let e = 0; e < numEdges; e++) {
      const se = surf.getInt32((firstEdge + e) * 4, true);
      const edge = Math.abs(se);
      const v = edges.getUint16(edge * 4 + (se < 0 ? 2 : 0), true);
      points.push([verts.getFloat32(v * 12, true), verts.getFloat32(v * 12 + 4, true), verts.getFloat32(v * 12 + 8, true)]);
    }
    if (points.length < 3) continue;
    const z = points.reduce((a, p) => a + p[2], 0) / points.length;
    if ((options.minZ !== undefined && z < options.minZ) || (options.maxZ !== undefined && z > options.maxZ)) continue;
    out.push({ points });
  }
  return out;
}
