// Line of sight through a GoldSrc map (.bsp v30, read-only), for plan 5.q: could the recorder actually see an enemy?
// Uses the drawn world's BSP tree (hull 0: a point, not a player box): a point is blocked when it lies in a solid leaf.
// Brush entities (doors, glass, func_wall) and smoke are not counted, so "in sight" can be a little generous.
import type { Vec3 } from './hull.js';

const LUMP_PLANES = 1, LUMP_NODES = 5, LUMP_LEAFS = 10, LUMP_MODELS = 14;
const CONTENTS_SOLID = -2;

function lump(bsp: Uint8Array, i: number): DataView {
  const v = new DataView(bsp.buffer, bsp.byteOffset, bsp.byteLength);
  const ofs = v.getInt32(4 + i * 8, true), len = v.getInt32(8 + i * 8, true);
  return new DataView(bsp.buffer, bsp.byteOffset + ofs, len);
}

export interface Sight {
  /** True if the point is inside solid world geometry. */
  solid(p: Vec3): boolean;
  /** True if nothing solid lies on the straight line from a to b (checked every `step` units). */
  clear(a: Vec3, b: Vec3, step?: number): boolean;
}

export function readSight(bsp: Uint8Array): Sight {
  const planes = lump(bsp, LUMP_PLANES), nodes = lump(bsp, LUMP_NODES), leafs = lump(bsp, LUMP_LEAFS), models = lump(bsp, LUMP_MODELS);
  const nPlanes = planes.byteLength / 20;
  const pn = new Float64Array(nPlanes * 4);
  const ptype = new Int32Array(nPlanes);
  for (let i = 0; i < nPlanes; i++) {
    for (let k = 0; k < 4; k++) pn[i * 4 + k] = planes.getFloat32(i * 20 + k * 4, true);
    ptype[i] = planes.getInt32(i * 20 + 16, true);
  }
  // dnode_t: planenum i32, children i16[2], mins i16[3], maxs i16[3], firstface u16, numfaces u16 (24 bytes).
  const nNodes = nodes.byteLength / 24;
  const nPlane = new Int32Array(nNodes), nFront = new Int16Array(nNodes), nBack = new Int16Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    nPlane[i] = nodes.getInt32(i * 24, true);
    nFront[i] = nodes.getInt16(i * 24 + 4, true);
    nBack[i] = nodes.getInt16(i * 24 + 6, true);
  }
  // dleaf_t: contents i32, … (28 bytes).
  const nLeafs = leafs.byteLength / 28;
  const contents = new Int32Array(nLeafs);
  for (let i = 0; i < nLeafs; i++) contents[i] = leafs.getInt32(i * 28, true);
  // dmodel_t: mins[3], maxs[3], origin[3] floats, headnode i32[4] (model 0 = the world; headnode[0] = drawn BSP).
  const head = models.getInt32(36, true);

  const solid = (p: Vec3): boolean => {
    let n = head;
    for (let guard = 0; n >= 0 && guard < 4096; guard++) {
      const pl = nPlane[n];
      const t = ptype[pl];
      const d = (t < 3 ? p[t] : pn[pl * 4] * p[0] + pn[pl * 4 + 1] * p[1] + pn[pl * 4 + 2] * p[2]) - pn[pl * 4 + 3];
      n = d >= 0 ? nFront[n] : nBack[n];
    }
    const leaf = -n - 1;
    return leaf < 0 || leaf >= nLeafs ? true : contents[leaf] === CONTENTS_SOLID;
  };
  const clear = (a: Vec3, b: Vec3, step = 8): boolean => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      if (solid([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])) return false;
    }
    return true;
  };
  return { solid, clear };
}
