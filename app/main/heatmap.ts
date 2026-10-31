// 5.k heatmaps on the details page: deaths, kills with killer → victim lines and fight distances, bomb plants by site,
// and where players spent their time. Everything is turned into picture pixels (1024 x 768) here; the window only draws.
// Background: the game's overview picture when it fits this map version, otherwise the map's floor drawn from the .bsp
// (plan 2.14 fallback), otherwise a plain area fitted to the positions. Map files are only read.
import { applySiteLetters, floorRangeFromPositions, readFloorPolygons, readMapFacts, siteAt, type BombSite } from '../../engine/src/map/bsp.js';
import { OVERVIEW_HEIGHT, OVERVIEW_WIDTH, type Projection } from '../../engine/src/map/overview.js';
import type { MatchData, PlayerTrack, TrackPoint, Vec3 } from '../../engine/src/match/types.js';
import type { HeatKill, HeatmapData } from '../shared/api.js';
import { grenadeThrows } from '../../engine/src/match/grenades.js';
import { playersByName } from './details-extra.js';

/** Size of one heat cell in picture pixels. */
export const HEAT_CELL = 8;
const COLS = OVERVIEW_WIDTH / HEAT_CELL, ROWS = OVERVIEW_HEIGHT / HEAT_CELL;
/** Time spent is counted in steps of this many seconds (one step = one count). */
const HEAT_STEP = 0.5;

const side = (t: string | undefined): 'T' | 'CT' | undefined => (t === 'T' || t === 'CT' ? t : undefined);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A projection that fits world (x, y) bounds into the picture with a margin; north up. */
export function fitProjection(minX: number, minY: number, maxX: number, maxY: number, margin = 24): Projection {
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const s = Math.min((OVERVIEW_WIDTH - 2 * margin) / w, (OVERVIEW_HEIGHT - 2 * margin) / h);
  const ox = (OVERVIEW_WIDTH - w * s) / 2, oy = (OVERVIEW_HEIGHT - h * s) / 2;
  return (x, y) => [ox + (x - minX) * s, oy + (maxY - y) * s];
}

/** The map's floor as one SVG path in picture pixels, and the projection used. Tiny faces are left out. */
export function floorBackground(bsp: Uint8Array, zs: number[]): { path: string; project: Projection } | undefined {
  const polys = readFloorPolygons(bsp, floorRangeFromPositions(zs) ?? {});
  if (polys.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p.points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const project = fitProjection(minX, minY, maxX, maxY);
  const parts: string[] = [];
  for (const p of polys) {
    const pts = p.points.map(([x, y]) => project(x, y));
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [a, b] = pts[i], [c, d] = pts[(i + 1) % pts.length]; area += a * d - b * c; }
    if (Math.abs(area) < 2) continue;
    parts.push(`M${pts.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L')}Z`);
  }
  return { path: parts.join(''), project };
}

/** The point of a sorted track nearest to time t, within maxGap seconds. */
function near<T extends { time: number }>(pts: T[], t: number, maxGap: number): T | undefined {
  let lo = 0, hi = pts.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].time < t) lo = mid + 1; else hi = mid; }
  let best: T | undefined;
  for (const i of [lo - 1, lo]) {
    const p = pts[i];
    if (p && Math.abs(p.time - t) <= maxGap && (!best || Math.abs(p.time - t) < Math.abs(best.time - t))) best = p;
  }
  return best;
}

/** Where a player was at time t: seen (exact) first, then the radar, then a sound he made. */
export function positionAt(track: PlayerTrack | undefined, t: number): { pos: Vec3; source: 'seen' | 'radar' | 'heard' } | undefined {
  if (!track) return undefined;
  const alive = (p: TrackPoint) => p.alive;
  const s = near(track.seen.filter(alive), t, 0.6);
  if (s) return { pos: [s.x, s.y, s.z], source: 'seen' };
  const r = near(track.radar, t, 1.2);
  if (r) return { pos: [r.x, r.y, r.z], source: 'radar' };
  const h = near(track.heard, t, 1);
  if (h) return { pos: [h.x, h.y, h.z], source: 'heard' };
  return undefined;
}

export interface HeatmapInput {
  m: MatchData;
  mapName: string;
  checksum: number;
  /** The .bsp of exactly this map version, if known. */
  bsp?: Uint8Array;
  /** The game's overview picture and its projection, when it fits this map version. */
  overview?: { project: Projection };
}

/** 5.k: everything the Heatmaps tab draws. `m` must be extracted with tracks. */
export function heatmapData(input: HeatmapInput): HeatmapData {
  return heatmapAndProjection(input).data;
}

/** The heatmap data plus the world → picture projection it used (kept for the radar replay, 5.j). */
export function heatmapAndProjection({ m, mapName, checksum, bsp, overview }: HeatmapInput): { data: HeatmapData; project: Projection } {
  const tracks = new Map((m.tracks ?? []).map((t) => [t.player, t]));
  const byId = new Map(m.players.map((p) => [p.id, p]));
  const sides = playersByName(m);
  const nameOf = (id: number | null | undefined) => (id === null || id === undefined ? undefined : byId.get(id)?.name);

  // Background and projection.
  let sites: BombSite[] = [];
  if (bsp) { try { sites = applySiteLetters(readMapFacts(bsp).bombSites, mapName, checksum); } catch { /* unreadable: no sites */ } }
  let project: Projection;
  let floorPath: string | undefined, note: string | undefined;
  const zs = (m.tracks ?? []).flatMap((t) => t.seen.map((p) => p.z));
  if (overview) {
    project = overview.project;
  } else {
    const floor = bsp ? floorBackground(bsp, zs) : undefined;
    if (floor) {
      ({ path: floorPath, project } = floor);
      note = "Today's overview picture doesn't match this map version, so the map is drawn from the map file itself.";
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
      for (const t of m.tracks ?? []) for (const p of t.seen) add(p.x, p.y);
      for (const d of m.deaths) add(d.position[0], d.position[1]);
      project = Number.isFinite(minX) ? fitProjection(minX - 200, minY - 200, maxX + 200, maxY + 200) : fitProjection(-2048, -2048, 2048, 2048);
      note = "This demo's map version wasn't found, so there's no map underneath; the points are still in the right places relative to each other.";
    }
  }
  const px = (p: Vec3): [number, number] => { const [x, y] = project(p[0], p[1]); return [round1(x), round1(y)]; };

  // Kills with victim (corpse) and killer positions.
  const usedDeaths = new Set<number>();
  const kills: HeatKill[] = [];
  for (const k of m.kills) {
    let victimPos: Vec3 | undefined;
    let victimFrom: HeatKill['victimFrom'] = 'corpse';
    let best = -1;
    m.deaths.forEach((d, i) => {
      if (usedDeaths.has(i) || d.victim !== k.victim || d.time < k.time - 0.5 || d.time > k.time + 10) return;
      if (best < 0 || d.time < m.deaths[best].time) best = i;
    });
    if (best >= 0) { usedDeaths.add(best); victimPos = m.deaths[best].position; }
    else {
      const p = positionAt(tracks.get(k.victim), k.time);
      if (p) { victimPos = p.pos; victimFrom = p.source; }
    }
    if (!victimPos) continue;
    const killer = k.killer !== null && !k.suicide ? positionAt(tracks.get(k.killer), k.time) : undefined;
    const victimName = nameOf(k.victim) ?? '?';
    const killerName = k.killer === null ? 'the world' : nameOf(k.killer) ?? '?';
    const [vx, vy] = px(victimPos);
    const kill: HeatKill = {
      time: k.time, round: k.round, weapon: k.weapon, headshot: k.headshot, teamKill: k.teamKill, suicide: k.suicide,
      victim: victimName, victimTeam: side(k.victimTeam) ?? sides.get(victimName)?.team, vx, vy, victimFrom,
      killer: killerName, killerTeam: side(k.killerTeam) ?? sides.get(killerName)?.team,
    };
    if (killer) {
      [kill.kx, kill.ky] = px(killer.pos);
      kill.killerFrom = killer.source;
      kill.distance = Math.round(Math.hypot(killer.pos[0] - victimPos[0], killer.pos[1] - victimPos[1], killer.pos[2] - victimPos[2]));
    }
    kills.push(kill);
  }

  // Bomb plants, with their site.
  const plants = m.bomb.filter((b) => b.kind === 'planted' && b.position).map((b) => {
    const [x, y] = px(b.position!);
    const s = siteAt(sites, b.position!);
    return { x, y, round: b.round, time: b.time, site: s ? sites.find((x) => x.index === s)?.letter : undefined };
  });

  // 5.w grenades: where thrown from and where they went off, with the thrower when known.
  const grenades: HeatmapData['grenades'] = grenadeThrows(m).map((g) => {
    const [fx, fy] = px(g.from), [tx, ty] = px(g.to);
    const thrower = nameOf(g.thrower);
    return { kind: g.kind, time: Math.round(g.time * 10) / 10, round: g.round, fx, fy, tx, ty, flight: g.flight, ...(thrower ? { thrower, team: sides.get(thrower)?.team ?? side(byId.get(g.thrower!)?.team) } : {}) };
  });

  // Time spent: one count per HEAT_STEP seconds alive at a known position (seen, or the radar), per player.
  const heat: HeatmapData['heat'] = {};
  const roundAt = (t: number) => m.rounds.find((r) => t >= r.start && t <= (r.end ?? r.start))?.number ?? 0;
  for (const t of m.tracks ?? []) {
    const name = nameOf(t.player);
    if (!name || byId.get(t.player)?.isHltv) continue;
    const pts = [...t.seen.filter((p) => p.alive), ...t.radar.filter((p) => p.alive)].sort((a, b) => a.time - b.time);
    // Key = round * cells + cell (round 0 = before round 1 or between rounds).
    const cells = new Map<number, number>();
    let lastStep = -1;
    for (const p of pts) {
      const step = Math.floor(p.time / HEAT_STEP);
      if (step === lastStep) continue;
      lastStep = step;
      const [x, y] = project(p.x, p.y);
      const c = Math.floor(x / HEAT_CELL), r = Math.floor(y / HEAT_CELL);
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
      const key = roundAt(p.time) * COLS * ROWS + r * COLS + c;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    if (cells.size === 0) continue;
    const row = heat[name] ?? { team: sides.get(name)?.team ?? side(byId.get(t.player)?.team), cells: [] };
    for (const [key, n] of cells) row.cells.push([key % (COLS * ROWS), n, Math.floor(key / (COLS * ROWS))]);
    heat[name] = row;
  }

  const data: HeatmapData = {
    width: OVERVIEW_WIDTH, height: OVERVIEW_HEIGHT, cell: HEAT_CELL, step: HEAT_STEP,
    useMapPicture: !!overview, floorPath, note,
    sites: sites.map((s) => { const [x, y] = project((s.mins[0] + s.maxs[0]) / 2, (s.mins[1] + s.maxs[1]) / 2); return { letter: s.letter, x: Math.round(x), y: Math.round(y) }; }),
    kills, plants, grenades, heat, recording: m.recording,
  };
  return { data, project };
}
