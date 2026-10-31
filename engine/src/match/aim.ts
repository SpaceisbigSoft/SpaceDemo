// 5.u Recorder aim coaching (POV demos): reaction time, crosshair placement and shooting while moving, for the player
// who recorded the demo. Uses his own client data (view angles, speed, fire button, exact shot times: `extractMatch(demo,
// { aim: true })`) and the other players' positions from every packet.
//
// Precision (plan 5.u): the recorder's own view and shots are exact on his screen's timeline, so his ping does not
// distort the numbers. Other players are known only at the server's update rate (measured per demo, usually 20/s =
// 50 ms) and his game drew them about 0.1 s after they arrived (client interpolation, ex_interp 0.1). Reaction times
// are therefore shown as ≈ value ± REACTION_MARGIN.
import type { Sight } from '../map/sight.js';
import type { AimData, Kill, Round, ViewSample } from './types.js';

/** How late an enemy was drawn after his position arrived (GoldSrc client interpolation, default ex_interp 0.1 s). */
export const DRAW_DELAY = 0.1;
/** ± margin shown on reaction times (update interval + interpolation; plan risk R16). */
export const REACTION_MARGIN = 0.1;
/** An enemy out of sight for longer than this and then seen again is a new appearance. */
const NEW_SIGHTING_GAP = 1;
/** A shot this long after an appearance still counts as the reaction to it. */
const MAX_REACTION = 2;
/** Faster than this is "expecting him" (pre-aimed or pre-fired), not a reaction to seeing him. */
export const ANTICIPATED = 0.12;
/** A position older than this is no longer where the player is (he left the recorder's view area). */
const STALE = 0.25;
/** The shot was aimed at this enemy when the crosshair was within this angle of him (degrees). */
const AIMED_AT = 10;
/** CS view offsets: eye (≈ head) above a player's origin, standing and crouching. */
const HEAD = 17, HEAD_DUCK = 12;
/** Horizontal half field of view (CS default fov 90) and the 4:3 screen's vertical half (tan 45° × 3/4). */
const TAN_H = 1, TAN_V = 0.75;

/**
 * Speed (units/s, horizontal) above which a weapon loses accuracy on the ground, from the CS 1.6 game code as
 * re-implemented in ReGameDLL_CS (wpn_shared/wpn_*.cpp, PrimaryAttack: `velocity.Length2D() > N`). 0 = any movement.
 * null = speed on the ground doesn't matter (SMGs, shotguns). Every weapon is inaccurate in the air (not on ground).
 * CS 1.5 (2002) values are not verified; assumed the same.
 */
export const ACCURATE_SPEED: Record<string, number | null> = {
  ak47: 140, m4a1: 140, aug: 140, sg552: 140, famas: 140, galil: 140, m249: 140,
  p90: 170, scout: 170,
  awp: 10,
  glock18: 0, usp: 0, p228: 0, deagle: 0, elite: 0, fiveseven: 0, g3sg1: 0, sg550: 0,
  mp5navy: null, tmp: null, mac10: null, ump45: null, m3: null, xm1014: null,
};

/** Weapon name from a weapon-fire event name (CS events: "mp5n", "elite_left", …); undefined for knife/other events. */
export function shotWeapon(event: string): string | undefined {
  const e = event.toLowerCase();
  if (e === 'mp5n') return 'mp5navy';
  if (e.startsWith('elite')) return 'elite';
  return e in ACCURATE_SPEED ? e : undefined;
}

export type ShotState = 'accurate' | 'moving' | 'air';

export interface AimShot {
  time: number;
  round: number;
  weapon: string;
  /** Horizontal speed at the shot (units/s). */
  speed: number;
  /** The weapon's accurate-speed limit (see ACCURATE_SPEED), null = no limit on the ground. */
  limit: number | null;
  duck: boolean;
  state: ShotState;
}

export interface AimEngagement {
  round: number;
  /** When the enemy first appeared on the recorder's screen (position arrival time; drawn ~DRAW_DELAY later). */
  time: number;
  enemy: number;
  /** Distance (units). */
  distance: number;
  /** Angle between the crosshair and the enemy's head when he appeared (degrees), and its parts: horizontal (+ =
   *  enemy to the right of the crosshair) and vertical (+ = enemy's head above the crosshair). */
  crosshair: number;
  crossH: number;
  crossV: number;
  /** Seconds from the enemy being drawn to the first shot at him (≈ ± REACTION_MARGIN), if he shot. */
  reaction?: number;
  /** Reaction faster than humanly possible: he was expecting the enemy (pre-aim / pre-fire). */
  anticipated?: boolean;
  /** He was already firing when the enemy appeared (no reaction time). */
  alreadyFiring?: boolean;
  weapon?: string;
  /** He killed this enemy / this enemy killed him, while in sight (or within a second after). */
  outcome?: 'won' | 'lost';
}

export interface AimReport {
  method: 'sight' | 'view';
  /** Measured median interval between other players' updates (s). */
  updateInterval: number;
  margin: number;
  engagements: AimEngagement[];
  shots: AimShot[];
}

export interface AimInput {
  aim: AimData;
  rounds: Round[];
  kills: Kill[];
  /** The recorder's player ids (all connections). */
  recorder: number[];
  /** Enemy player ids (all connections of the other team's players). */
  enemies: number[];
  /** Line of sight through the map, if the map file is known (otherwise only the field of view counts). */
  sight?: Sight;
}

type V3 = [number, number, number];
const DEG = Math.PI / 180;

/** Forward / right / up unit vectors for a view (pitch + = down). */
function basis(v: ViewSample): { f: V3; r: V3; u: V3 } {
  const p = v.pitch * DEG, y = v.yaw * DEG;
  const f: V3 = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
  const r: V3 = [Math.sin(y), -Math.cos(y), 0];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angles from the crosshair to a point: total, horizontal (+ right) and vertical (+ above), degrees. */
export function aimError(v: ViewSample, target: V3): { total: number; h: number; v: number } {
  const d: V3 = [target[0] - v.eye[0], target[1] - v.eye[1], target[2] - v.eye[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const { f, r, u } = basis(v);
  const total = Math.acos(Math.max(-1, Math.min(1, dot(d, f) / len))) / DEG;
  const z = dot(d, f);
  return { total, h: Math.atan2(dot(d, r), z) / DEG, v: Math.atan2(dot(d, u), Math.hypot(z, dot(d, r))) / DEG };
}

/** Per player: the full-rate points as a searchable list. */
class Positions {
  readonly t: Float64Array;
  constructor(readonly p: number[]) {
    this.t = new Float64Array(p.length / 5);
    for (let i = 0; i < this.t.length; i++) this.t[i] = p[i * 5];
  }
  /** Latest position at or before `time` (not older than STALE). */
  at(time: number): { pos: V3; crouch: boolean } | undefined {
    let lo = 0, hi = this.t.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.t[mid] <= time + 1e-6) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0 || time - this.t[best] > STALE) return undefined;
    const i = best * 5;
    return { pos: [this.p[i + 1], this.p[i + 2], this.p[i + 3]], crouch: this.p[i + 4] === 1 };
  }
}

const head = (x: { pos: V3; crouch: boolean }): V3 => [x.pos[0], x.pos[1], x.pos[2] + (x.crouch ? HEAD_DUCK : HEAD)];

/** Could the recorder see this player in this frame: on screen and (with the map) nothing solid in between? */
function onScreen(v: ViewSample, x: { pos: V3; crouch: boolean }, sight?: Sight): boolean {
  const { f, r, u } = basis(v);
  const h = head(x);
  const d: V3 = [h[0] - v.eye[0], h[1] - v.eye[1], h[2] - v.eye[2] - (x.crouch ? 12 : 17)]; // body centre
  const z = dot(d, f);
  if (z <= 1) return false;
  const pad = 24 / z; // half a body width / height beyond the edge still shows part of him
  if (Math.abs(dot(d, r)) / z > TAN_H + pad || Math.abs(dot(d, u)) / z > TAN_V + pad * 2) return false;
  if (!sight) return true;
  const top = x.crouch ? HEAD_DUCK : HEAD;
  return [top, 0, x.crouch ? -10 : -20].some((dz) => sight.clear(v.eye, [x.pos[0], x.pos[1], x.pos[2] + dz], 12));
}

const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function aimCoaching(input: AimInput): AimReport {
  const { aim, rounds, kills, recorder, enemies, sight } = input;
  const recSet = new Set(recorder), enemySet = new Set(enemies);
  const pos = new Map<number, Positions>();
  for (const p of aim.players) if (enemySet.has(p.player)) pos.set(p.player, new Positions(p.points));

  const gaps: number[] = [];
  for (const p of pos.values()) for (let i = 1; i < p.t.length; i++) { const g = p.t[i] - p.t[i - 1]; if (g > 0 && g < 0.5) gaps.push(g); }
  const updateInterval = r2(median(gaps) ?? 0.05);

  const view = aim.view;
  const viewAt = (t: number): ViewSample | undefined => {
    let lo = 0, hi = view.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (view[mid].time <= t + 1e-6) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    // A shot event is written just before the frame that carries it: take the closer of the two neighbours.
    const a = view[best], b = view[best + 1];
    if (a && b) return Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a;
    return a ?? b;
  };

  const engagements: AimEngagement[] = [];
  const shots: AimShot[] = [];
  const guns = aim.shots.map((s) => ({ ...s, gun: shotWeapon(s.weapon) })).filter((s): s is typeof s & { gun: string } => !!s.gun);

  rounds.forEach((r, i) => {
    const live = r.freezeEnd ?? r.start;
    const end = Math.min(rounds[i + 1]?.start ?? Infinity, (r.end ?? Infinity) + 1);
    const recDied = kills.find((k) => recSet.has(k.victim) && k.time >= r.start && k.time <= end)?.time ?? Infinity;
    const until = Math.min(end, recDied);
    const died = new Map<number, number>();
    for (const k of kills) if (enemySet.has(k.victim) && k.time >= r.start && k.time <= end && !died.has(k.victim)) died.set(k.victim, k.time);

    // Shots while moving.
    for (const s of guns) {
      if (s.time < live || s.time > until) continue;
      const v = viewAt(s.time);
      if (!v || Math.abs(v.time - s.time) > 0.1 || !v.alive) continue;
      const limit = ACCURATE_SPEED[s.gun] ?? null;
      const state: ShotState = !v.onGround ? 'air' : limit !== null && v.speed > Math.max(limit, 0.5) ? 'moving' : 'accurate';
      shots.push({ time: s.time, round: r.number, weapon: s.gun, speed: Math.round(v.speed), limit, duck: v.duck, state });
    }

    // Appearances: per enemy, the first frame he is on screen after not being on screen for NEW_SIGHTING_GAP.
    const frames = view.filter((v) => v.time >= live && v.time <= until && v.alive);
    for (const [id, p] of pos) {
      const gone = died.get(id) ?? Infinity;
      let lastSeen = -Infinity;
      let open: AimEngagement | undefined;
      let openLast = -Infinity;
      const close = () => {
        if (!open) return;
        const win = [open.time, openLast + 1];
        const k = kills.find((x) => x.time >= win[0] && x.time <= win[1] && ((x.killer !== null && recSet.has(x.killer) && x.victim === id) || (x.killer === id && recSet.has(x.victim))));
        if (k) open.outcome = k.victim === id ? 'won' : 'lost';
        open = undefined;
      };
      for (const v of frames) {
        if (v.time >= gone) break;
        const x = p.at(v.time);
        if (!x || !onScreen(v, x, sight)) continue;
        if (v.time - lastSeen > NEW_SIGHTING_GAP) {
          close();
          const e = aimError(v, head(x));
          open = {
            round: r.number, time: v.time, enemy: id,
            distance: Math.round(Math.hypot(x.pos[0] - v.eye[0], x.pos[1] - v.eye[1], x.pos[2] - v.eye[2])),
            crosshair: r1(e.total), crossH: r1(e.h), crossV: r1(e.v),
          };
          engagements.push(open);
          openLast = v.time;
        }
        lastSeen = v.time;
        openLast = v.time;
      }
      close();
    }
  });

  // Reactions: the first shot at the enemy after he appeared.
  for (const e of engagements) {
    const before = view.filter((v) => v.time >= e.time - 0.3 && v.time < e.time);
    const firingBefore = before.some((v) => v.attack) || guns.some((s) => s.time >= e.time - 0.3 && s.time < e.time);
    for (const s of guns) {
      if (s.time < e.time) continue;
      if (s.time > e.time + MAX_REACTION) break;
      const v = viewAt(s.time);
      const x = pos.get(e.enemy)?.at(s.time);
      if (!v || !x) continue;
      if (aimError(v, head(x)).total > AIMED_AT) continue;
      // Aimed at this enemy rather than another one nearer the crosshair.
      const other = [...pos].some(([id, p]) => id !== e.enemy && (() => { const y = p.at(s.time); return !!y && aimError(v, head(y)).total < aimError(v, head(x)).total && onScreen(v, y, sight); })());
      if (other) continue;
      e.weapon = s.gun;
      if (firingBefore) { e.alreadyFiring = true; break; }
      const rt = s.time - e.time - DRAW_DELAY;
      e.reaction = r2(Math.max(0, rt));
      if (rt < ANTICIPATED) e.anticipated = true;
      break;
    }
  }
  engagements.sort((a, b) => a.time - b.time);
  return { method: sight ? 'sight' : 'view', updateInterval, margin: REACTION_MARGIN, engagements, shots };
}

/** Summary numbers for a set of engagements and shots. */
export function aimSummary(es: AimEngagement[], shots: AimShot[]) {
  const reacted = es.filter((e) => e.reaction !== undefined && !e.anticipated).map((e) => e.reaction!);
  return {
    engagements: es.length,
    reactions: reacted.length,
    medianReaction: median(reacted),
    anticipated: es.filter((e) => e.anticipated).length,
    alreadyFiring: es.filter((e) => e.alreadyFiring).length,
    medianCrosshair: median(es.map((e) => e.crosshair)),
    within5: es.filter((e) => e.crosshair <= 5).length,
    shots: shots.length,
    accurate: shots.filter((s) => s.state === 'accurate').length,
    moving: shots.filter((s) => s.state === 'moving').length,
    air: shots.filter((s) => s.state === 'air').length,
  };
}
