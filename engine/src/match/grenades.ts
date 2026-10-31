// 5.w grenade throws: for every grenade the demo followed (MatchData.grenades), where it started and where it went off
// (smoke: where it lay smoking), when, in which round, and who threw it. The thrower is the player standing where it
// was first seen, preferring the one who had that grenade in hand just before, with the grenade flying away from him;
// else unknown. (Radio calls don't help: a player's demo only hears his own team's radio.)
import type { MatchData, Vec3 } from './types.js';

export interface GrenadeThrow {
  /** Its index in MatchData.grenades. */
  index: number;
  kind: 'he' | 'flash' | 'smoke';
  time: number;
  round?: number;
  from: Vec3;
  to: Vec3;
  /** Seconds from the first point to where it went off / landed. */
  flight: number;
  thrower?: number;
  /** How the thrower was found. */
  by?: 'position';
}

const IN_HAND: Record<GrenadeThrow['kind'], string> = { he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade' };

export function grenadeThrows(m: MatchData): GrenadeThrow[] {
  const tracks = m.tracks ?? [];
  /**
   * The thrower: among the players known within 100 units of where the grenade was first seen (within 0.5 s), the one
   * who had that grenade in hand just before (seen weapon); the grenade must fly away from him. Nearest wins a tie.
   */
  const throwerOf = (kind: GrenadeThrow['kind'], a: { time: number; x: number; y: number }, dir: [number, number]) => {
    let best: { player: number; score: number } | undefined;
    for (const tr of tracks) {
      let near: number | undefined;
      let holding = false;
      for (const pts of [tr.seen, tr.radar]) {
        let lo = 0, hi = pts.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].time < a.time - 1.5) lo = mid + 1; else hi = mid; }
        for (let i = lo; i < pts.length && pts[i].time <= a.time + 0.5; i++) {
          const p = pts[i];
          if (!p.alive) continue;
          if (p.weapon === IN_HAND[kind] && p.time <= a.time + 0.2) holding = true;
          if (Math.abs(p.time - a.time) > 0.5) continue;
          const dx = a.x - p.x, dy = a.y - p.y;
          const d = Math.hypot(dx, dy);
          // Flying away from him (or too close to tell).
          if (d > 100 || (d > 24 && dx * dir[0] + dy * dir[1] < 0)) continue;
          near = Math.min(near ?? Infinity, d);
        }
      }
      if (near === undefined) continue;
      const score = near - (holding ? 1000 : 0);
      if (!best || score < best.score) best = { player: tr.player, score };
    }
    return best?.player;
  };
  const out: GrenadeThrow[] = [];
  for (const [index, g] of (m.grenades ?? []).entries()) {
    if (g.points.length < 2) continue;
    const a = g.points[0], a2 = g.points[1];
    // Where it went off: HE/flash at the last point; a smoke grenade where it stopped moving.
    let land = g.points.length - 1;
    if (g.kind === 'smoke') {
      while (land > 0 && Math.hypot(g.points[land].x - g.points[land - 1].x, g.points[land].y - g.points[land - 1].y) < 2) land--;
    }
    const b = g.points[land];
    const thrower = throwerOf(g.kind, a, [a2.x - a.x, a2.y - a.y]);
    const round = m.rounds.find((r) => a.time >= r.start && a.time <= (r.end ?? r.start) + 5)?.number;
    out.push({ index, kind: g.kind, time: a.time, round, from: [a.x, a.y, a.z], to: [b.x, b.y, b.z], flight: Math.round((b.time - a.time) * 10) / 10, thrower, ...(thrower !== undefined ? { by: 'position' as const } : {}) });
  }
  return out;
}
