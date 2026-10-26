// Player collision from a GoldSrc map (.bsp v30, read-only) (plan 2.15).
// The map stores, besides the drawn geometry, "clip hulls": the solid world already grown by the player's box, so one
// point test answers "does a standing (or crouching) player fit with his origin here?". Hull 1 = standing player
// (32×32×72, origin 36 above the feet), hull 3 = crouching player (32×32×36, origin 18 above the feet).

const LUMP_ENTITIES = 0, LUMP_PLANES = 1, LUMP_CLIPNODES = 9, LUMP_MODELS = 14;

export const HULL_STANDING = 1;
export const HULL_CROUCHING = 3;
/** Height of the origin above the feet. */
export const ORIGIN_ABOVE_FEET = { [HULL_STANDING]: 36, [HULL_CROUCHING]: 18 } as const;

export type Vec3 = [number, number, number];

interface Model {
  mins: Vec3;
  maxs: Vec3;
  origin: Vec3;
  headnode: number[];
}

/** Brush entities that block players like walls do (doors and breakables are left out: they open or break). */
const SOLID_CLASSES = new Set(['func_wall', 'func_wall_toggle', 'func_pushable']);

export interface Collision {
  /** True if a player of this hull does NOT fit with his origin at p (inside the solid world or a solid brush entity). */
  solid(p: Vec3, hull?: number): boolean;
  /**
   * Height of the feet of a standing player dropped straight down from `from` (origin), searching at most `maxFall`
   * units; undefined if nothing is found (or `from` itself is inside solid).
   */
  groundBelow(from: Vec3, maxFall: number): number | undefined;
  /** Ladder volumes (func_ladder) as boxes. */
  ladders: { mins: Vec3; maxs: Vec3 }[];
  worldMins: Vec3;
  worldMaxs: Vec3;
}

function lump(bsp: Uint8Array, i: number): DataView {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4 + i * 8, true), len = v.getInt32(8 + i * 8, true);
  return new DataView(bsp.buffer, bsp.byteOffset + ofs, len);
}

export function readCollision(bsp: Uint8Array, entities: { classname: string; props: Record<string, string> }[]): Collision {
  const planes = lump(bsp, LUMP_PLANES), clip = lump(bsp, LUMP_CLIPNODES), mv = lump(bsp, LUMP_MODELS);
  const nPlanes = planes.byteLength / 20;
  const pn: Float64Array = new Float64Array(nPlanes * 4);
  const pt: Int32Array = new Int32Array(nPlanes);
  for (let i = 0; i < nPlanes; i++) {
    for (let k = 0; k < 4; k++) pn[i * 4 + k] = planes.getFloat32(i * 20 + k * 4, true);
    pt[i] = planes.getInt32(i * 20 + 16, true);
  }
  const nClip = clip.byteLength / 8;
  const cPlane = new Int32Array(nClip), cFront = new Int16Array(nClip), cBack = new Int16Array(nClip);
  for (let i = 0; i < nClip; i++) {
    cPlane[i] = clip.getInt32(i * 8, true);
    cFront[i] = clip.getInt16(i * 8 + 4, true);
    cBack[i] = clip.getInt16(i * 8 + 6, true);
  }
  const model = (n: number): Model => {
    const o = n * 64, f = (k: number) => mv.getFloat32(o + k * 4, true);
    return { mins: [f(0), f(1), f(2)], maxs: [f(3), f(4), f(5)], origin: [f(6), f(7), f(8)], headnode: [0, 1, 2, 3].map((h) => mv.getInt32(o + 36 + h * 4, true)) };
  };
  // Same walk as the engine's hull point test: follow the clip tree until a leaf (negative = contents).
  const contents = (head: number, x: number, y: number, z: number): number => {
    let n = head;
    while (n >= 0) {
      const p = cPlane[n] * 4, t = pt[cPlane[n]];
      const d = t === 0 ? x - pn[p + 3] : t === 1 ? y - pn[p + 3] : t === 2 ? z - pn[p + 3] : pn[p] * x + pn[p + 1] * y + pn[p + 2] * z - pn[p + 3];
      n = d >= 0 ? cFront[n] : cBack[n];
    }
    return n;
  };
  const CONTENTS_SOLID = -2;
  const world = model(0);
  const extra: { m: Model; off: Vec3 }[] = [];
  const ladders: { mins: Vec3; maxs: Vec3 }[] = [];
  for (const e of entities) {
    const n = Number((e.props.model ?? '').replace('*', ''));
    if (!(e.props.model ?? '').startsWith('*') || !Number.isFinite(n)) continue;
    const off = (e.props.origin ?? '0 0 0').trim().split(/\s+/).map(Number) as Vec3;
    const m = model(n);
    if (SOLID_CLASSES.has(e.classname)) extra.push({ m, off: [off[0] || 0, off[1] || 0, off[2] || 0] });
    if (e.classname === 'func_ladder') ladders.push({ mins: m.mins.map((v, i) => v + (off[i] || 0)) as Vec3, maxs: m.maxs.map((v, i) => v + (off[i] || 0)) as Vec3 });
  }
  const PAD = 40; // hull growth (16 xy, 36 z) plus a margin
  const solid = (p: Vec3, hull = HULL_STANDING): boolean => {
    if (contents(world.headnode[hull], p[0], p[1], p[2]) === CONTENTS_SOLID) return true;
    for (const { m, off } of extra) {
      const x = p[0] - off[0], y = p[1] - off[1], z = p[2] - off[2];
      if (x < m.mins[0] - PAD || x > m.maxs[0] + PAD || y < m.mins[1] - PAD || y > m.maxs[1] + PAD || z < m.mins[2] - PAD || z > m.maxs[2] + PAD) continue;
      if (contents(m.headnode[hull], x, y, z) === CONTENTS_SOLID) return true;
    }
    return false;
  };
  const groundBelow = (from: Vec3, maxFall: number): number | undefined => {
    if (solid(from)) return undefined;
    // Coarse steps down, then halve the step to find the exact surface (within 1/8 unit).
    let z = from[2];
    const stop = from[2] - maxFall;
    const step = 8;
    while (z - step >= stop) {
      if (solid([from[0], from[1], z - step])) {
        let lo = z - step, hi = z; // lo solid, hi empty
        while (hi - lo > 0.125) { const mid = (lo + hi) / 2; if (solid([from[0], from[1], mid])) lo = mid; else hi = mid; }
        return hi - ORIGIN_ABOVE_FEET[HULL_STANDING];
      }
      z -= step;
    }
    return undefined;
  };
  return { solid, groundBelow, ladders, worldMins: world.mins, worldMaxs: world.maxs };
}

/** Reads the entity list (same parser as bsp.ts, kept here so this module stands alone). */
export function readEntityList(bsp: Uint8Array): { classname: string; props: Record<string, string> }[] {
  const l = lump(bsp, LUMP_ENTITIES);
  const text = new TextDecoder('latin1').decode(new Uint8Array(l.buffer, l.byteOffset, l.byteLength));
  const out: { classname: string; props: Record<string, string> }[] = [];
  for (const b of text.matchAll(/\{([^}]*)\}/g)) {
    const props: Record<string, string> = {};
    for (const m of b[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)) props[m[1]] = m[2];
    out.push({ classname: props.classname ?? '', props });
  }
  return out;
}
