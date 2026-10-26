// Position estimates between sightings (plan 2.16).
// For each player and moment without a confirmed position, estimate one from the known positions before and after
// (the whole demo is read first): seen (exact), radar (teammates), heard (sound positions), spawn at round start,
// death spot. The estimate follows the shortest walkable route (plan 2.15) between the two, at the speed the weapon in
// hand allows. Every estimate carries an uncertainty radius and a confidence, both calibrated on Set 1 (real POV
// knowledge vs HLTV truth, tools/dev/estimate-check.ts). Gaps that are too long to walk in the time are flagged.

import type { Vec3 } from './types.js';
import { nearestNode, nodePos, pathTo, shortestFrom, type WalkMap } from '../map/walk.js';

/** Highest run speed per weapon in hand (units/s), from the game code (ReGameDLL `*_MAX_SPEED`); checked against Set 1. */
export const WEAPON_SPEED: Record<string, number> = {
  knife: 250, usp: 250, glock18: 250, deagle: 250, p228: 250, elite: 250, fiveseven: 250, mp5: 250, mp5navy: 250,
  tmp: 250, mac10: 250, ump45: 250, p90: 245, ak47: 221, m4a1: 230, sg552: 235, aug: 240, awp: 210, scout: 260,
  g3sg1: 210, sg550: 210, m249: 220, m3: 230, xm1014: 240, galil: 240, famas: 240, c4: 250, hegrenade: 250,
  flashbang: 250, smokegrenade: 250,
};
export const DEFAULT_SPEED = 250;

export type AnchorKind = 'seen' | 'radar' | 'heard' | 'spawn' | 'death';

export interface Anchor {
  time: number;
  pos: Vec3;
  kind: AnchorKind;
  /** Typical error of this kind of anchor, in units. */
  accuracy: number;
  weapon?: string;
}

/** Typical error per anchor kind (units); measured on Set 1 against HLTV truth (see Reference). */
export const ANCHOR_ACCURACY: Record<AnchorKind, number> = { seen: 2, radar: 16, heard: 24, spawn: 160, death: 40 };

export type Timing = 'uniform' | 'goThenWait' | 'waitThenGo' | 'centred' | 'mixed' | 'adaptive';

export interface EstimatedPoint {
  time: number;
  x: number;
  y: number;
  z: number;
  /** Where the position comes from. 'estimated' = between anchors; 'held' = after the last anchor (no later sighting). */
  source: AnchorKind | 'estimated' | 'held';
  /** Uncertainty radius (units): calibrated so the true position was inside it for ~80 % of Set 1 test moments. */
  radius: number;
  /** 0–1: how likely the true position is within 256 units of this one (calibrated on Set 1). */
  confidence: number;
  /** The gap could not be walked in the time at full speed (data problem or a missed shortcut). */
  impossible?: boolean;
}

export interface LifeInput {
  /** When the life starts (round start: players can't move during freeze time) and ends (death or round end). */
  start: number;
  end: number;
  anchors: Anchor[];
}

export interface EstimateOptions {
  /** Seconds between output points. */
  step?: number;
  timing?: Timing;
  /** Share of the weapon's top speed a player walks at on average when travelling (1 = full speed). */
  pace?: number;
  /** 'mixed' timing: share of the spare time spent travelling (0 = go then wait, 1 = uniform). */
  mix?: number;
}

/** Uncertainty radius and confidence as a function of the time to the nearest anchor (calibrated; see estimate-check). */
export interface Calibration {
  /** [seconds to nearest anchor, radius (units), confidence 0–1] in increasing time; values between are interpolated. */
  between: [number, number, number][];
  /** Same, for time since the last anchor when nothing comes after ('held'). */
  held: [number, number, number][];
}

/**
 * Measured on Set 1 (2026-10-26, tools/dev/estimate-check.ts --calibrate): 4 POV demos estimated from what the recorder
 * knew, checked against the HLTV recording of the same match half; 38,782 estimated and 1,372 held moments.
 * Radius = 80th-percentile error at that time to the nearest anchor; confidence = share within 256 units.
 */
export let CALIBRATION: Calibration = {
  between: [[0, 16, 1], [0.3, 41, 0.98], [0.8, 96, 0.95], [1.5, 183, 0.89], [2.5, 258, 0.8], [4, 362, 0.71], [7.5, 592, 0.54], [15, 890, 0.46], [35, 1011, 0.43]],
  held: [[0, 16, 1], [0.8, 136, 0.95], [1.5, 340, 0.7], [2.5, 457, 0.62], [4, 714, 0.48], [7.5, 925, 0.46], [15, 1372, 0.42], [35, 2547, 0.13]],
};
export function setCalibration(c: Calibration) { CALIBRATION = c; }

function lookup(table: [number, number, number][], tau: number): [number, number] {
  if (tau <= table[0][0]) return [table[0][1], table[0][2]];
  for (let i = 1; i < table.length; i++) {
    if (tau <= table[i][0]) {
      const [t0, r0, c0] = table[i - 1], [t1, r1, c1] = table[i];
      const f = (tau - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * f, c0 + (c1 - c0) * f];
    }
  }
  const last = table[table.length - 1];
  return [last[1], last[2]];
}

/** Use the straight line when the walking route is at most this much longer (cell zig-zag). */
export let STRAIGHT_IF_WITHIN = 1.15;

/** A polyline with distances, to place a point a given distance along it. */
class Route {
  pts: Vec3[];
  cum: number[];
  constructor(pts: Vec3[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  }
  get length() { return this.cum[this.cum.length - 1]; }
  at(d: number): Vec3 {
    if (d <= 0) return this.pts[0];
    if (d >= this.length) return this.pts[this.pts.length - 1];
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    const f = (d - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    const a = this.pts[lo], b = this.pts[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
}

/** Walking route between two positions (player origins), or a straight line when the walk map can't connect them. */
export function routeBetween(w: WalkMap | undefined, a: Vec3, b: Vec3, maxCost = Infinity): { route: Route; walkable: boolean } {
  const straight = new Route([a, b]);
  if (!w) return { route: straight, walkable: false };
  const na = nearestNode(w, a), nb = nearestNode(w, b);
  if (na === undefined || nb === undefined) return { route: straight, walkable: false };
  if (na === nb) return { route: straight, walkable: true };
  const sp = shortestFrom(w, na, maxCost);
  if (!Number.isFinite(sp.cost[nb])) return { route: straight, walkable: false };
  // Route points at origin height (feet + 36), from the exact start to the exact end.
  const mid = pathTo(sp.prev, nb).map((i) => { const p = nodePos(w.nodes[i]); return [p[0], p[1], p[2] + 36] as Vec3; });
  const route = new Route([a, ...mid.slice(1, -1), b]);
  // A route that is nearly straight is the straight line plus cell zig-zag: use the line.
  return { route: route.length <= straight.length * STRAIGHT_IF_WITHIN + 32 ? straight : route, walkable: true };
}

/**
 * Estimates one player's position through one life (round start to death or round end), every `step` seconds.
 * Anchors must be inside the life; a 'spawn' anchor at the start is expected (the caller adds it).
 */
export function estimateLife(w: WalkMap | undefined, life: LifeInput, options: EstimateOptions = {}): EstimatedPoint[] {
  const step = options.step ?? 0.25, timing = options.timing ?? 'adaptive', pace = options.pace ?? 0.85, mix = options.mix ?? 0.5;
  const anchors = [...life.anchors].filter((a) => a.time >= life.start - 0.01 && a.time <= life.end + 0.01).sort((a, b) => a.time - b.time);
  const out: EstimatedPoint[] = [];
  if (anchors.length === 0) return out;
  const routes = new Map<number, { route: Route; walkable: boolean; impossible: boolean; travel: number }>();
  let k = 0; // index of the last anchor at or before t
  for (let t = life.start; t <= life.end + 1e-9; t += step) {
    while (k + 1 < anchors.length && anchors[k + 1].time <= t) k++;
    const a = anchors[k].time <= t ? anchors[k] : undefined;
    const b = a ? anchors[k + 1] : anchors[0];
    // At an anchor (within half a step): the anchor itself.
    const near = [a, b].filter((x): x is Anchor => !!x && Math.abs(x.time - t) <= step / 2).sort((x, y) => x.accuracy - y.accuracy)[0];
    if (near) {
      const [radius, confidence] = near.kind === 'seen' ? [near.accuracy, 1] : [near.accuracy * 2, Math.max(0.5, 1 - near.accuracy / 400)];
      out.push({ time: round2(t), x: near.pos[0], y: near.pos[1], z: near.pos[2], source: near.kind, radius, confidence });
      continue;
    }
    if (!a) {
      // Before the first anchor (no spawn anchor given): hold the first one.
      const [radius, confidence] = lookup(CALIBRATION.held, b!.time - t);
      out.push({ time: round2(t), x: b!.pos[0], y: b!.pos[1], z: b!.pos[2], source: 'held', radius: Math.max(radius, b!.accuracy), confidence });
      continue;
    }
    if (!b) {
      // After the last anchor: stay there (we don't know where they went); uncertainty grows with time.
      const [radius, confidence] = lookup(CALIBRATION.held, t - a.time);
      out.push({ time: round2(t), x: a.pos[0], y: a.pos[1], z: a.pos[2], source: 'held', radius: Math.max(radius, a.accuracy), confidence });
      continue;
    }
    let r = routes.get(k);
    const T = b.time - a.time;
    const vmax = WEAPON_SPEED[a.weapon ?? b.weapon ?? ''] ?? DEFAULT_SPEED;
    if (!r) {
      const rb = routeBetween(w, a.pos, b.pos, vmax * 1.4 * T + 400);
      const L = rb.route.length;
      // Too far to walk in the time even at full speed plus a jump bonus: flag it.
      const impossible = L > vmax * 1.15 * T + 64 + a.accuracy + b.accuracy;
      const travel = Math.min(T, L / (vmax * pace));
      r = { ...rb, impossible, travel };
      routes.set(k, r);
    }
    const L = r.route.length;
    const dt = t - a.time;
    let d: number;
    switch (timing) {
      case 'goThenWait': d = L * Math.min(1, dt / r.travel); break;
      case 'waitThenGo': d = L * Math.max(0, 1 - (T - dt) / r.travel); break;
      case 'centred': { const wait = (T - r.travel) / 2; d = L * Math.min(1, Math.max(0, (dt - wait) / r.travel)); break; }
      case 'mixed': { const travel = r.travel + mix * (T - r.travel); d = L * Math.min(1, dt / travel); break; }
      case 'adaptive': {
        // Set 1 hold-out: short gaps are best spread evenly; in long gaps players go first, then hold a spot.
        const m = Math.min(1, Math.max(0.25, 1 - ((T - 10) / 20) * 0.75));
        const travel = r.travel + m * (T - r.travel);
        d = L * Math.min(1, dt / travel);
        break;
      }
      default: d = L * (dt / T);
    }
    const p = r.route.at(d);
    const tau = Math.min(dt, T - dt);
    const [radius, confidence] = lookup(CALIBRATION.between, tau);
    out.push({
      time: round2(t), x: p[0], y: p[1], z: p[2], source: 'estimated',
      radius: Math.max(radius, a.accuracy, b.accuracy), confidence: r.impossible ? confidence * 0.5 : confidence,
      ...(r.impossible ? { impossible: true } : {}),
    });
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface PlayerLifeData {
  rounds: { number: number; start: number; freezeEnd?: number; end?: number }[];
  kills: { time: number; victim: number }[];
  deaths: { time: number; victim?: number; position: Vec3 }[];
  track?: { seen: { time: number; x: number; y: number; z: number; alive: boolean; weapon?: string }[]; radar: { time: number; x: number; y: number; z: number; alive: boolean }[]; heard: { time: number; x: number; y: number; z: number; alive: boolean }[] };
  /** The team's spawn points (from the map). */
  spawns: Vec3[];
  /** When the player left the server (no lives after that). */
  leftAt?: number;
}

/** One player's lives (per round) with their anchors, from match data (plan 2.12/2.13) and the map's spawns. */
export function livesOf(playerId: number, d: PlayerLifeData): LifeInput[] {
  const lives: LifeInput[] = [];
  // A connection with no sighting, sound or death at all (e.g. an old connection before a reconnect) gets no lives.
  const evidence = (d.track?.seen.length ?? 0) + (d.track?.heard.length ?? 0) + (d.track?.radar.length ?? 0) + d.kills.filter((k) => k.victim === playerId).length;
  if (evidence === 0) return lives;
  const centre: Vec3 = d.spawns.length ? [0, 1, 2].map((i) => d.spawns.reduce((s, p) => s + p[i], 0) / d.spawns.length) as Vec3 : [0, 0, 0];
  // Spawn spread: how far the team's spawn points are from their centre, on average.
  const spread = d.spawns.length ? d.spawns.reduce((s, p) => s + Math.hypot(p[0] - centre[0], p[1] - centre[1]), 0) / d.spawns.length : 400;
  const rounds = [...d.rounds].sort((a, b) => a.start - b.start);
  rounds.forEach((r, i) => {
    if (d.leftAt !== undefined && d.leftAt <= r.start) return;
    const roundEnd = r.end ?? rounds[i + 1]?.start ?? Infinity;
    const kill = d.kills.find((k) => k.victim === playerId && k.time >= r.start && k.time <= roundEnd);
    const end = Math.min(roundEnd, kill?.time ?? Infinity);
    if (!Number.isFinite(end)) return;
    const anchors: Anchor[] = [];
    const inLife = (t: number) => t >= r.start && t <= end;
    for (const p of d.track?.seen ?? []) if (p.alive && inLife(p.time)) anchors.push({ time: p.time, pos: [p.x, p.y, p.z], kind: 'seen', accuracy: ANCHOR_ACCURACY.seen, weapon: p.weapon });
    for (const p of d.track?.radar ?? []) if (p.alive && inLife(p.time)) anchors.push({ time: p.time, pos: [p.x, p.y, p.z], kind: 'radar', accuracy: ANCHOR_ACCURACY.radar });
    for (const p of d.track?.heard ?? []) if (p.alive && inLife(p.time)) anchors.push({ time: p.time, pos: [p.x, p.y, p.z], kind: 'heard', accuracy: ANCHOR_ACCURACY.heard });
    // Spawn: players can't move before freeze time ends. Use the spawn closest to the first sighting, if it comes
    // before anyone could have walked far; else the centre of the team's spawns.
    const first = anchors.filter((a) => a.kind === 'seen').sort((a, b) => a.time - b.time)[0];
    const freezeEnd = Math.max(r.start, r.freezeEnd ?? r.start);
    if (!first || first.time > freezeEnd + 0.5) {
      const near = first && d.spawns.length ? d.spawns.reduce((b, p) => (Math.hypot(p[0] - first.pos[0], p[1] - first.pos[1]) < Math.hypot(b[0] - first.pos[0], b[1] - first.pos[1]) ? p : b)) : undefined;
      // Only trust "nearest spawn" when the first sighting is within reach of it (short time after freeze end).
      const pos = near && first && Math.hypot(near[0] - first.pos[0], near[1] - first.pos[1]) < 250 * (first.time - freezeEnd) * 0.3 ? near : centre;
      const acc = pos === centre ? spread : 32;
      anchors.push({ time: r.start, pos, kind: 'spawn', accuracy: acc });
      if (freezeEnd > r.start) anchors.push({ time: freezeEnd, pos, kind: 'spawn', accuracy: acc });
    }
    if (kill) {
      const body = d.deaths.find((x) => x.victim === playerId && x.time >= kill.time && x.time <= kill.time + 10);
      if (body) anchors.push({ time: kill.time, pos: body.position, kind: 'death', accuracy: ANCHOR_ACCURACY.death });
    }
    lives.push({ start: r.start, end, anchors: thin(anchors) });
  });
  return lives;
}

/** Keeps the most accurate anchor per 0.1 s (sounds and radar often come with a sighting at the same moment). */
function thin(anchors: Anchor[]): Anchor[] {
  const best = new Map<number, Anchor>();
  for (const a of anchors) {
    const k = Math.round(a.time * 10);
    const o = best.get(k);
    if (!o || a.accuracy < o.accuracy) best.set(k, a);
  }
  return [...best.values()].sort((a, b) => a.time - b.time);
}

/**
 * Every player's estimated timeline for a whole demo: one list of points per player id, every `step` seconds through
 * each life (round start to death or round end). Needs the match data with tracks (extractMatch(..., { tracks: true }))
 * and the map's spawns; the walk map (buildWalkMap from the map + this demo's tracks) gives the routes.
 */
export function estimateMatch(
  match: { rounds: PlayerLifeData['rounds']; kills: { time: number; victim: number }[]; deaths: { time: number; victim?: number; position: Vec3 }[]; players: { id: number; team?: string; isHltv: boolean; leftAt?: number }[]; tracks?: (NonNullable<PlayerLifeData['track']> & { player: number })[] },
  spawns: { T: Vec3[]; CT: Vec3[] },
  walk: WalkMap | undefined,
  options: EstimateOptions = {},
): Map<number, EstimatedPoint[]> {
  const out = new Map<number, EstimatedPoint[]>();
  for (const p of match.players) {
    if (p.isHltv || (p.team !== 'T' && p.team !== 'CT')) continue;
    const track = match.tracks?.find((t) => t.player === p.id);
    const lives = livesOf(p.id, { rounds: match.rounds, kills: match.kills, deaths: match.deaths, track, spawns: p.team === 'T' ? spawns.T : spawns.CT, leftAt: p.leftAt });
    const points = lives.flatMap((l) => estimateLife(walk, l, options));
    if (points.length) out.set(p.id, points);
  }
  return out;
}
