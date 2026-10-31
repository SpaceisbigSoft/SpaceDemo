// 5.s Line of sight between players: at each moment, which player could see which enemy (in his field of view, with
// nothing solid in the map between his eye and the enemy's head, chest or legs). From that: who saw whom first in a
// fight, kills through walls (no clear line at the kill) and kills from behind (killer outside the victim's view).
//
// Limits: only the world's solid geometry counts — doors, glass, func_wall boxes and smoke are not walls here (so
// "could see" can be a little generous, and a shot through a door can look clear). Other players are known about 10
// times a second (tracks) and their view direction is the yaw only (no pitch): ±0.1 s, horizontal view only.
import type { Sight } from '../map/sight.js';
import type { Kill, PlayerTrack, Round, TrackPoint } from './types.js';

/** Sample step (s) and how far a known position may be from the sample time. */
const STEP = 0.1, NEAR = 0.15;
/** Half the horizontal field of view (CS fov 90) plus a little for the target's body. */
export const HALF_FOV = 50;
/** A gap longer than this ends a "seeing" streak. */
const STREAK_GAP = 0.5;
/** Farther than this nobody is checked (units). */
const MAX_DIST = 4000;
const EYE = 17, EYE_DUCK = 12;
/** Victim's view to killer angle above which a kill counts as from behind (degrees). */
export const BEHIND = 110;
/** Weapons that don't need a line of sight. */
const NO_SIGHT = /grenade|hegren|world|worldspawn|trigger_hurt|c4/i;

export interface KillSight {
  time: number;
  round?: number;
  killer: number;
  victim: number;
  /** Both positions known at the kill. */
  known: boolean;
  /** A clear line from the killer's eye to the victim's head, chest or legs at the kill. */
  clear?: boolean;
  /** Angle between where the victim was facing and the direction to the killer (0 = facing him, 180 = his back). */
  offView?: number;
  /** Seconds the killer had been seeing the victim before the kill / the victim the killer (undefined = not seen). */
  killerSaw?: number;
  victimSaw?: number;
}

export interface FirstSight {
  round: number;
  time: number;
  /** Who saw whom; `mutual` = both saw each other within the same tenth of a second. */
  seer: number;
  seen: number;
  mutual: boolean;
}

export interface SightlinesInput {
  tracks: PlayerTrack[];
  kills: Kill[];
  rounds: Round[];
  /** Side of each player id (all connections). */
  team: Map<number, 'T' | 'CT'>;
  sight: Sight;
}

export interface SightlinesResult {
  kills: KillSight[];
  /** Per round: the first time a player saw an enemy (after freeze time). */
  firsts: FirstSight[];
  /** Pairs checked and milliseconds spent (trial numbers). */
  checks: number;
}

type P = { x: number; y: number; z: number; yaw?: number; crouch?: boolean };

function nearest(pts: TrackPoint[], t: number): TrackPoint | undefined {
  let lo = 0, hi = pts.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].time < t) lo = mid + 1; else hi = mid; }
  let best: TrackPoint | undefined;
  for (const i of [lo - 1, lo]) {
    const p = pts[i];
    if (p && Math.abs(p.time - t) <= NEAR && (!best || Math.abs(p.time - t) < Math.abs(best.time - t))) best = p;
  }
  return best;
}

const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const dirTo = (a: P, b: P) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** Could a see b: b inside a's horizontal view (when a's yaw is known) and a clear line from a's eye to b. */
export function canSee(sight: Sight, a: P, b: P): boolean {
  if (Math.hypot(b.x - a.x, b.y - a.y) > MAX_DIST) return false;
  if (a.yaw !== undefined && angleDiff(dirTo(a, b), a.yaw) > HALF_FOV) return false;
  return clearLine(sight, a, b);
}

/** A clear line from a's eye to b's head, chest or legs (field of view not checked). */
export function clearLine(sight: Sight, a: P, b: P): boolean {
  const eye: [number, number, number] = [a.x, a.y, a.z + (a.crouch ? EYE_DUCK : EYE)];
  const top = b.crouch ? EYE_DUCK : EYE;
  return [top, 0, b.crouch ? -10 : -20].some((dz) => sight.clear(eye, [b.x, b.y, b.z + dz], 12));
}

export function sightlines(input: SightlinesInput): SightlinesResult {
  const { tracks, kills, rounds, team, sight } = input;
  const seenBy = new Map<number, TrackPoint[]>();
  for (const t of tracks) {
    if (!team.has(t.player)) continue;
    const pts = t.seen.filter((p) => p.alive).sort((a, b) => a.time - b.time);
    if (pts.length) seenBy.set(t.player, pts);
  }
  const ids = [...seenBy.keys()];
  const out: SightlinesResult = { kills: [], firsts: [], checks: 0 };
  /** Streak start per ordered pair "a>b" (a sees b), and when it was last true. */
  const streak = new Map<string, { from: number; last: number }>();

  for (const r of rounds) {
    const live = r.freezeEnd ?? r.start;
    const end = r.end ?? live;
    streak.clear();
    const dead = new Map<number, number>();
    for (const k of kills) if (k.time >= r.start && k.time <= end + 1 && !dead.has(k.victim)) dead.set(k.victim, k.time);
    let first: FirstSight | undefined;
    const roundKills = kills.filter((k) => k.time >= live && k.time <= end + 0.5).sort((a, b) => a.time - b.time);
    let ki = 0;
    for (let t = live; t <= end + 1e-6; t += STEP) {
      const pos = new Map<number, P>();
      for (const id of ids) {
        if ((dead.get(id) ?? Infinity) <= t) continue;
        const p = nearest(seenBy.get(id)!, t);
        if (p) pos.set(id, p);
      }
      const now: [number, number][] = [];
      for (const [a, pa] of pos) for (const [b, pb] of pos) {
        if (a === b || team.get(a) === team.get(b)) continue;
        out.checks++;
        if (canSee(sight, pa, pb)) now.push([a, b]);
      }
      for (const [a, b] of now) {
        const k = `${a}>${b}`;
        const s = streak.get(k);
        if (s && t - s.last <= STREAK_GAP) s.last = t; else streak.set(k, { from: t, last: t });
      }
      if (!first && now.length) {
        const [a, b] = now[0];
        first = { round: r.number, time: Math.round(t * 100) / 100, seer: a, seen: b, mutual: now.some(([x, y]) => x === b && y === a) };
      }
      // Kills that happened in this step.
      while (ki < roundKills.length && roundKills[ki].time <= t + STEP / 2) {
        const k = roundKills[ki++];
        if (k.killer === null || k.teamKill || k.suicide || NO_SIGHT.test(k.weapon)) continue;
        const pk = seenBy.get(k.killer) && nearest(seenBy.get(k.killer)!, k.time);
        // The victim's last position alive.
        const pv = seenBy.get(k.victim) && nearest(seenBy.get(k.victim)!, k.time - 0.05);
        const ks: KillSight = { time: k.time, round: r.number, killer: k.killer, victim: k.victim, known: !!(pk && pv) };
        if (pk && pv) {
          ks.clear = clearLine(sight, pk, pv);
          if (pv.yaw !== undefined) ks.offView = Math.round(angleDiff(dirTo(pv, pk), pv.yaw));
          const sk = streak.get(`${k.killer}>${k.victim}`), sv = streak.get(`${k.victim}>${k.killer}`);
          if (sk && k.time - sk.last <= STREAK_GAP + STEP) ks.killerSaw = Math.round((k.time - sk.from) * 10) / 10;
          if (sv && k.time - sv.last <= STREAK_GAP + STEP) ks.victimSaw = Math.round((k.time - sv.from) * 10) / 10;
        }
        out.kills.push(ks);
      }
    }
    if (first) out.firsts.push(first);
  }
  return out;
}
