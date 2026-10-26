// Walkable-area map per map version (plan 2.15): a graph of the places a player can stand and how he can move between
// them, for shortest walking paths (position estimates, plan 2.16) and analysis.
//
// Two sources, merged:
//  1. The map itself (.bsp, read-only): floor surfaces checked with the game's own player collision (clip hulls):
//     a spot counts when a standing or crouching player fits there with ground under his feet. Neighbouring spots are
//     linked when a player can walk, step, jump (≤ JUMP_HEIGHT up) or drop (≤ MAX_DROP down) from one to the other
//     without hitting a wall, plus ladders (func_ladder).
//  2. What players actually did in demos of that map version: every pair of consecutive positions on the ground adds
//     the spots and a link (this catches trick jumps, boosts, moving platforms and anything the map check misses).
// Spots are 32×32-unit cells; a cell column can hold several floors (stacked areas such as de_nuke's two sites).
// Only areas a player can reach from a spawn point (or that players were seen on) are kept.

import { HULL_CROUCHING, HULL_STANDING, readCollision, readEntityList, type Collision, type Vec3 } from './hull.js';

export const CELL = 32;
/** Highest step up without jumping (the game's stepsize). */
export const STEP_HEIGHT = 18;
/**
 * Highest ledge a player climbs with a (crouch-)jump: a standing jump lifts the feet ≈ 45 units, tucking the legs
 * (crouch-jump) ≈ 18 more. Set 2026-10-26 from Set 1: players climb 64-unit ledges on de_prodigy and de_inferno.
 */
export const JUMP_HEIGHT = 64;
/** Highest drop counted as a normal move (more hurts; still possible, so observed drops are kept anyway). */
export const MAX_DROP = 220;
/** Two floors in one column closer than this are the same floor. */
const LAYER_JOIN = 30;
/** Vertical step when scanning a column for floors (a floor thinner than this could be missed; real floors are thicker). */
const SCAN_STEP = 6;

export enum NodeFlag {
  Geometry = 1,
  Observed = 2,
  /** Only a crouching player fits (vents, low passages). */
  CrouchOnly = 4,
}

export enum EdgeKind {
  Walk = 0,
  Jump = 1,
  Drop = 2,
  Ladder = 3,
  Observed = 4,
}

export interface WalkNode {
  ix: number;
  iy: number;
  /** A point in the cell where a player is known to fit (the cell centre may be inside a wall). */
  x: number;
  y: number;
  /** Height of the feet (floor). */
  z: number;
  flags: number;
  /** How many demo samples landed on this spot. */
  visits: number;
}

export interface WalkEdge {
  to: number;
  /** Cost in units of walking distance (crouch, ladder and jump moves cost more). */
  cost: number;
  kind: EdgeKind;
}

export interface WalkMap {
  nodes: WalkNode[];
  edges: WalkEdge[][];
  /** Column "ix,iy" → node indices, lowest floor first. */
  columns: Map<string, number[]>;
}

/** A node's position in world coordinates, at the feet. */
export const nodePos = (n: WalkNode): Vec3 => [n.x, n.y, n.z];

const key = (ix: number, iy: number) => `${ix},${iy}`;

class Builder {
  nodes: WalkNode[] = [];
  edges: Map<number, WalkEdge>[] = [];
  columns = new Map<string, number[]>();

  find(ix: number, iy: number, z: number): number | undefined {
    const col = this.columns.get(key(ix, iy));
    if (!col) return undefined;
    let best: number | undefined, bd = LAYER_JOIN;
    for (const i of col) { const d = Math.abs(this.nodes[i].z - z); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  add(ix: number, iy: number, z: number, flag: number, x = (ix + 0.5) * CELL, y = (iy + 0.5) * CELL): number {
    const found = this.find(ix, iy, z);
    if (found !== undefined) {
      const n = this.nodes[found];
      // Crouching somewhere does not make it crouch-only; standing there proves it is not.
      n.flags |= flag & ~NodeFlag.CrouchOnly;
      if (!(flag & NodeFlag.CrouchOnly)) n.flags &= ~NodeFlag.CrouchOnly;
      return found;
    }
    const i = this.nodes.length;
    this.nodes.push({ ix, iy, x, y, z, flags: flag, visits: 0 });
    this.edges.push(new Map());
    const k = key(ix, iy);
    const col = this.columns.get(k) ?? [];
    col.push(i);
    col.sort((a, b) => this.nodes[a].z - this.nodes[b].z);
    this.columns.set(k, col);
    return i;
  }

  link(a: number, b: number, cost: number, kind: EdgeKind) {
    if (a === b) return;
    const old = this.edges[a].get(b);
    if (!old || cost < old.cost) this.edges[a].set(b, { to: b, cost, kind: old && old.kind === EdgeKind.Observed ? old.kind : kind });
  }
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Where a player's feet are if he is on the ground at origin p (rounded positions allowed), else undefined (in the air). */
export function feetAt(c: Collision, p: Vec3): { z: number; crouch: boolean } | undefined {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const q: Vec3 = [p[0] + dx, p[1] + dy, p[2] + 0.5];
    if (!c.solid(q, HULL_STANDING)) {
      const g = c.groundBelow(q, 8);
      return g === undefined ? undefined : { z: g, crouch: false };
    }
    if (!c.solid(q, HULL_CROUCHING)) {
      // Crouched: origin 18 above the feet; ground right below the crouch box.
      for (let d = 0.5; d <= 8; d += 0.5) if (c.solid([q[0], q[1], q[2] - d], HULL_CROUCHING)) return { z: q[2] - d + 0.5 - 18, crouch: true };
      return undefined;
    }
  }
  return undefined;
}

export interface Observation {
  /** Feet-or-origin samples of one player while alive, in time order. */
  points: { time: number; x: number; y: number; z: number }[];
}

/** Each player's life as a list of positions (the track's `seen` points while alive, split at gaps over 1.5 s). */
export function observationsFrom(tracks: { seen: { time: number; x: number; y: number; z: number; alive: boolean }[] }[]): Observation[] {
  const out: Observation[] = [];
  for (const t of tracks) {
    let cur: Observation['points'] = [];
    let last = -Infinity;
    for (const p of t.seen) {
      if (!p.alive || p.time - last > 1.5) { if (cur.length > 1) out.push({ points: cur }); cur = []; }
      if (p.alive) cur.push(p);
      last = p.time;
    }
    if (cur.length > 1) out.push({ points: cur });
  }
  return out;
}

export interface BuildOptions {
  /** Player movements from demos of this exact map version (plan 2.13 tracks, `seen` points while alive). */
  observations?: Observation[];
  /** Leave out the map-geometry part (used to test how well demos alone cover a map). */
  noGeometry?: boolean;
  /** Leave out the demo part. */
  noObservations?: boolean;
}

/** Builds the walkable-area map of one map version. */
export function buildWalkMap(bsp: Uint8Array, options: BuildOptions = {}): WalkMap {
  const entities = readEntityList(bsp);
  const col = readCollision(bsp, entities);
  const b = new Builder();
  const cellOf = (x: number, y: number) => [Math.floor(x / CELL), Math.floor(y / CELL)] as const;
  const centre = (ix: number, iy: number) => [(ix + 0.5) * CELL, (iy + 0.5) * CELL] as const;
  const spawns: Vec3[] = entities
    .filter((e) => e.classname === 'info_player_start' || e.classname === 'info_player_deathmatch')
    .map((e) => (e.props.origin ?? '0 0 0').split(/\s+/).map(Number) as Vec3);

  /** Spawn points are placed a little above the floor (players drop on spawn): find the floor under them. */
  const spawnFeet = (s: Vec3) => col.groundBelow([s[0], s[1], s[2] + 1], 128);

  /**
   * Every floor in one 32×32 column, found with the game's own collision: scanning down, each change from "fits" to
   * "solid" is a surface a player can stand on. Tried at the cell centre and 4 points ±10 units around it (a wall
   * closer than 16 units to the centre would otherwise hide the spot). Crouch-only spots: the crouching hull fits
   * where the standing one does not.
   */
  const scanColumn = (ix: number, iy: number, zTop: number, zBottom: number): { x: number; y: number; z: number; crouch: boolean }[] => {
    const [cx, cy] = centre(ix, iy);
    const found: { x: number; y: number; z: number; crouch: boolean }[] = [];
    let x = cx, y = cy;
    const addFloor = (z: number, crouch: boolean) => {
      const same = found.find((f) => Math.abs(f.z - z) < LAYER_JOIN);
      if (!same) found.push({ x, y, z, crouch });
      else if (same.crouch && !crouch) Object.assign(same, { x, y, z, crouch: false });
    };
    for (const [ox, oy] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
      x = cx + ox; y = cy + oy;
      for (const hull of [HULL_STANDING, HULL_CROUCHING]) {
        const lift = hull === HULL_STANDING ? 36 : 18;
        let prevEmpty = false;
        for (let z = zTop; z >= zBottom; z -= SCAN_STEP) {
          const empty = !col.solid([x, y, z], hull);
          if (prevEmpty && !empty) {
            let lo = z, hi = z + SCAN_STEP; // lo solid, hi empty
            while (hi - lo > 0.25) { const mid = (lo + hi) / 2; if (col.solid([x, y, mid], hull)) lo = mid; else hi = mid; }
            const feet = hi - lift;
            if (hull === HULL_STANDING) addFloor(feet, false);
            else if (col.solid([x, y, feet + 36 + 0.5], HULL_STANDING)) addFloor(feet, true);
          }
          prevEmpty = empty;
        }
      }
      if (found.length && ox === 0 && oy === 0 && found.every((f) => !f.crouch)) break; // the centre already sees it all
    }
    return found;
  };

  // 1. Spots from the map's floors (every column of the world).
  if (!options.noGeometry) {
    const [ix0, iy0] = cellOf(col.worldMins[0], col.worldMins[1]);
    const [ix1, iy1] = cellOf(col.worldMaxs[0], col.worldMaxs[1]);
    const zTop = col.worldMaxs[2] + 40, zBottom = col.worldMins[2];
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
      for (const f of scanColumn(ix, iy, zTop, zBottom)) b.add(ix, iy, f.z, NodeFlag.Geometry | (f.crouch ? NodeFlag.CrouchOnly : 0), f.x, f.y);
    }
    // Spawn points are always valid spots.
    for (const s of spawns) { const z = spawnFeet(s); if (z !== undefined) { const [ix, iy] = cellOf(s[0], s[1]); b.add(ix, iy, z, NodeFlag.Geometry, s[0], s[1]); } }

    // Links between neighbouring spots.
    const geomCount = b.nodes.length;
    for (let i = 0; i < geomCount; i++) {
      const a = b.nodes[i];
      const pa: Vec3 = nodePos(a);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const colB = b.columns.get(key(a.ix + dx, a.iy + dy));
        if (!colB) continue;
        for (const j of colB) {
          const n = b.nodes[j];
          const dz = n.z - a.z;
          if (dz > JUMP_HEIGHT || dz < -MAX_DROP) continue;
          const pb: Vec3 = nodePos(n);
          // Try the straight line between the two spots, then the same line shifted sideways (a player walks past a
          // corner, not through it; the shifted line's ends must fit too). Standing first, then crouching (low passages).
          // The body must pass at the higher of the two floors (walking up, or stepping off the ledge).
          const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
          const sx = -(pb[1] - pa[1]) / len, sy = (pb[0] - pa[0]) / len;
          const passes = (hull: number) => {
            const top = Math.max(a.z, n.z) + (hull === HULL_STANDING ? 36 : 18) + 1;
            for (const off of [0, 8, -8, 14, -14]) {
              const ax = pa[0] + sx * off, ay = pa[1] + sy * off, bx = pb[0] + sx * off, by = pb[1] + sy * off;
              let ok = true;
              for (const t of off === 0 ? [0.25, 0.5, 0.75] : [0, 0.25, 0.5, 0.75, 1]) {
                if (col.solid([ax + (bx - ax) * t, ay + (by - ay) * t, top], hull)) { ok = false; break; }
              }
              if (ok) return true;
            }
            return false;
          };
          const crouchOnlyEnd = ((a.flags | n.flags) & NodeFlag.CrouchOnly) !== 0;
          let crouch: boolean;
          if (!crouchOnlyEnd && passes(HULL_STANDING)) crouch = false;
          else if (passes(HULL_CROUCHING)) crouch = true;
          else continue;
          const top = Math.max(a.z, n.z) + (crouch ? 18 : 36) + 1;
          // No hole in between for level moves and climbs (drops may cross a gap: you just fall).
          if (dz > -STEP_HEIGHT) {
            const m: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, top];
            const g = col.groundBelow(m, Math.abs(dz) + 40);
            if (g === undefined && !col.solid([m[0], m[1], m[2]], HULL_STANDING)) {
              // Crouch passages: groundBelow uses the standing hull; accept if the crouch hull finds ground.
              if (!crouch) continue;
            }
          }
          const d = dist3(pa, pb);
          const kind = dz > STEP_HEIGHT + Math.hypot(dx, dy) * CELL * 0.95 ? EdgeKind.Jump : dz < -JUMP_HEIGHT ? EdgeKind.Drop : EdgeKind.Walk;
          const cost = d * (crouch ? 3 : 1) + (kind === EdgeKind.Jump ? 32 : 0);
          b.link(i, j, cost, kind);
        }
      }
    }
    // Ladders: link the spots at the foot and the top of each ladder both ways.
    for (const l of col.ladders) {
      const near: number[] = [];
      const [cx0, cy0] = cellOf(l.mins[0] - 48, l.mins[1] - 48), [cx1, cy1] = cellOf(l.maxs[0] + 48, l.maxs[1] + 48);
      for (let ix = cx0; ix <= cx1; ix++) for (let iy = cy0; iy <= cy1; iy++) for (const i of b.columns.get(key(ix, iy)) ?? []) {
        const z = b.nodes[i].z;
        if (z >= l.mins[2] - 48 && z <= l.maxs[2] + 24) near.push(i);
      }
      if (near.length < 2) continue;
      const zs = near.map((i) => b.nodes[i].z);
      const lo = Math.min(...zs), hi = Math.max(...zs);
      if (hi - lo < JUMP_HEIGHT) continue;
      const bottom = near.filter((i) => b.nodes[i].z < lo + 24), topN = near.filter((i) => b.nodes[i].z > hi - 24);
      for (const p of bottom) for (const q of topN) {
        const d = dist3(nodePos(b.nodes[p]), nodePos(b.nodes[q]));
        b.link(p, q, d * 1.3, EdgeKind.Ladder);
        b.link(q, p, d * 1.3, EdgeKind.Ladder);
      }
    }
  }

  // 2. Spots and links from what players did.
  if (!options.noObservations) {
    for (const obs of options.observations ?? []) {
      let prev: { node: number; time: number; pos: Vec3 } | undefined;
      for (const p of obs.points) {
        const f = feetAt(col, [p.x, p.y, p.z]);
        if (!f) continue; // in the air: the link is made from the last ground spot to the next one
        const [ix, iy] = cellOf(p.x, p.y);
        const node = b.add(ix, iy, f.z, NodeFlag.Observed | (f.crouch ? NodeFlag.CrouchOnly : 0), p.x, p.y);
        b.nodes[node].visits++;
        const pos: Vec3 = [p.x, p.y, f.z];
        if (prev) {
          const dt = p.time - prev.time;
          // Plausible move: not a respawn or a jump in time, at most a little faster than running speed (or a fall).
          if (dt > 0 && dt <= 1.5 && Math.hypot(pos[0] - prev.pos[0], pos[1] - prev.pos[1]) <= 320 * dt + 48 && prev.node !== node) {
            // Cost = distance between the two spots (not between the samples: two samples a few units apart can sit in
            // neighbouring cells, and pricing that hop at a few units would make paths impossibly short).
            const dn = dist3(nodePos(b.nodes[prev.node]), nodePos(b.nodes[node]));
            b.link(prev.node, node, dn, EdgeKind.Observed);
            // Level or uphill moves can be walked back; big drops are one-way.
            if (pos[2] - prev.pos[2] > -JUMP_HEIGHT) b.link(node, prev.node, dn, EdgeKind.Observed);
          }
        }
        prev = { node, time: p.time, pos };
      }
    }
  }

  // 3. Keep what a player can reach from a spawn or from a spot a player stood on in a demo. Walks, climbs, ladders
  // and observed moves count both ways (a missed link back is more likely than a dead end); big drops count one way
  // only, so roofs you could only drop down from are left out.
  const n = b.nodes.length;
  const forward: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const e of b.edges[i].values()) {
    forward[i].push(e.to);
    if (e.kind !== EdgeKind.Drop) forward[e.to].push(i);
  }
  const keep = new Uint8Array(n);
  const stack: number[] = [];
  for (const s of spawns) { const z = spawnFeet(s); if (z === undefined) continue; const [ix, iy] = cellOf(s[0], s[1]); const i = b.find(ix, iy, z); if (i !== undefined) stack.push(i); }
  for (let i = 0; i < n; i++) if (b.nodes[i].flags & NodeFlag.Observed) stack.push(i);
  for (const i of stack) keep[i] = 1;
  while (stack.length) { const i = stack.pop()!; for (const j of forward[i]) if (!keep[j]) { keep[j] = 1; stack.push(j); } }
  const remap = new Int32Array(n).fill(-1);
  const out: WalkMap = { nodes: [], edges: [], columns: new Map() };
  for (let i = 0; i < n; i++) if (keep[i]) { remap[i] = out.nodes.length; out.nodes.push(b.nodes[i]); }
  for (let i = 0; i < n; i++) if (keep[i]) out.edges.push([...b.edges[i].values()].filter((e) => keep[e.to]).map((e) => ({ ...e, to: remap[e.to] })));
  out.nodes.forEach((nd, i) => { const k = key(nd.ix, nd.iy); const c = out.columns.get(k) ?? []; c.push(i); out.columns.set(k, c); });
  for (const c of out.columns.values()) c.sort((a, c2) => out.nodes[a].z - out.nodes[c2].z);
  return out;
}

/**
 * The spot for a world position (feet or origin height; the closest floor at or below origin height is preferred).
 * Searches up to `radius` cells around; undefined if none.
 */
export function nearestNode(w: WalkMap, p: Vec3, radius = 2, originHeight = true): number | undefined {
  const ix = Math.floor(p[0] / CELL), iy = Math.floor(p[1] / CELL);
  const feet = originHeight ? p[2] - 36 : p[2];
  let best: number | undefined, bd = Infinity;
  for (let r = 0; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      for (const i of w.columns.get(key(ix + dx, iy + dy)) ?? []) {
        const n = w.nodes[i];
        const dz = n.z - feet;
        // Crouched players' origin is 18 lower; jumping players are above their floor: favour floors just below.
        const zCost = dz > 20 ? dz * 4 : dz < -80 ? -dz * 2 : Math.abs(dz) * 0.5;
        const c = Math.hypot(dx, dy) * CELL + zCost;
        if (c < bd) { bd = c; best = i; }
      }
    }
    if (best !== undefined && bd < (r + 1) * CELL) break;
  }
  return best;
}

/** Shortest paths from one spot (Dijkstra). Returns cost per node (Infinity = unreachable) and the previous node. */
export function shortestFrom(w: WalkMap, start: number, maxCost = Infinity): { cost: Float64Array; prev: Int32Array } {
  const n = w.nodes.length;
  const cost = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  // Binary heap of [cost, node].
  const heap: number[] = [];
  const push = (c: number, i: number) => {
    heap.push(c, i);
    let k = heap.length / 2 - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p * 2] <= heap[k * 2]) break; [heap[p * 2], heap[k * 2]] = [heap[k * 2], heap[p * 2]]; [heap[p * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[p * 2 + 1]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], heap[1]];
    const lc = heap.pop()!, li = heap.pop()!;
    // pop() takes node then cost order reversed: last pair is [c, i]
    if (heap.length) {
      heap[0] = li; heap[1] = lc;
      let k = 0;
      const len = heap.length / 2;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < len && heap[l * 2] < heap[m * 2]) m = l;
        if (r < len && heap[r * 2] < heap[m * 2]) m = r;
        if (m === k) break;
        [heap[m * 2], heap[k * 2]] = [heap[k * 2], heap[m * 2]]; [heap[m * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[m * 2 + 1]];
        k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(0, start);
  while (heap.length) {
    const [c, i] = pop();
    if (c > cost[i] || c > maxCost) continue;
    for (const e of w.edges[i]) {
      const nc = c + e.cost;
      if (nc < cost[e.to]) { cost[e.to] = nc; prev[e.to] = i; push(nc, e.to); }
    }
  }
  return { cost, prev };
}

/** The node path from the start of `shortestFrom` to `goal` (empty if unreachable). */
export function pathTo(prev: Int32Array, goal: number): number[] {
  const out: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/** Compact form for caching per map checksum. */
export function serializeWalkMap(w: WalkMap): { version: 1; cell: number; nodes: number[]; edges: number[][] } {
  return {
    version: 1,
    cell: CELL,
    nodes: w.nodes.flatMap((n) => [n.ix, n.iy, Math.round(n.x), Math.round(n.y), Math.round(n.z * 8) / 8, n.flags, n.visits]),
    edges: w.edges.map((es) => es.flatMap((e) => [e.to, Math.round(e.cost * 10) / 10, e.kind])),
  };
}

export function deserializeWalkMap(s: ReturnType<typeof serializeWalkMap>): WalkMap {
  const nodes: WalkNode[] = [];
  for (let i = 0; i < s.nodes.length; i += 7) nodes.push({ ix: s.nodes[i], iy: s.nodes[i + 1], x: s.nodes[i + 2], y: s.nodes[i + 3], z: s.nodes[i + 4], flags: s.nodes[i + 5], visits: s.nodes[i + 6] });
  const edges = s.edges.map((es) => { const o: WalkEdge[] = []; for (let i = 0; i < es.length; i += 3) o.push({ to: es[i], cost: es[i + 1], kind: es[i + 2] }); return o; });
  const columns = new Map<string, number[]>();
  nodes.forEach((n, i) => { const k = key(n.ix, n.iy); const c = columns.get(k) ?? []; c.push(i); columns.set(k, c); });
  return { nodes, edges, columns };
}
