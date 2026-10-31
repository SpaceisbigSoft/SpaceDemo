// 5.j 2D radar replay, step 1: everything one round needs to be replayed on the map — each player's known positions
// by source (seen = exact, radar = teammate on the radar, heard = a sound he made), weapon changes, kills and the bomb.
// Positions are in picture pixels (same projection as the heatmaps). Estimated positions (2.16) come in the next step.
import type { Projection } from '../../engine/src/map/overview.js';
import type { MatchData, Vec3 } from '../../engine/src/match/types.js';
import { estimateLife, livesOf } from '../../engine/src/match/estimate.js';
import type { WalkMap } from '../../engine/src/map/walk.js';
import type { HeatKill, ReplayData, ReplayPlayer } from '../shared/api.js';
import { playersByName } from './details-extra.js';
import { grenadeThrows } from '../../engine/src/match/grenades.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const side = (t: string | undefined): 'T' | 'CT' | undefined => (t === 'T' || t === 'CT' ? t : undefined);

/**
 * One round, from its start (freeze time) to the next round's start (or 5 s after its end). `kills` are the heatmap's
 * kills (killer and victim positions already in pixels).
 */
/** What estimating needs: the walk map (2.15) and the teams' spawn points. Without a map file there are no estimates. */
export interface EstimateInput { walk?: WalkMap; spawns: { T: Vec3[]; CT: Vec3[] } }

export function replayData(m: MatchData, project: Projection, kills: HeatKill[], roundNo: number, est?: EstimateInput): ReplayData | { error: string } {
  const i = m.rounds.findIndex((r) => r.number === roundNo);
  if (i < 0) return { error: `There's no round ${roundNo} in this demo.` };
  const r = m.rounds[i];
  const start = r.start, end = m.rounds[i + 1]?.start ?? (r.end ?? r.start) + 5;
  const inRound = (t: number) => t >= start && t <= end;
  const sides = playersByName(m);
  const byName = new Map<string, ReplayPlayer>();
  const px = (x: number, y: number) => { const [a, b] = project(x, y); return [r1(a), r1(b)] as const; };

  for (const t of m.tracks ?? []) {
    const p = m.players.find((x) => x.id === t.player);
    if (!p || p.isHltv || !p.name) continue;
    const row = byName.get(p.name) ?? { name: p.name, team: sides.get(p.name)?.team ?? side(p.team), recorder: p.isRecorder, seen: [], radar: [], heard: [], weapons: [] };
    let lastWeapon: string | undefined = row.weapons.at(-1)?.[1];
    for (const s of t.seen) {
      if (!inRound(s.time)) continue;
      const [x, y] = px(s.x, s.y);
      // Picture y points down, so the view direction turns the other way.
      row.seen.push(r1(s.time), x, y, s.yaw === undefined ? -1 : Math.round(((360 - s.yaw) % 360 + 360) % 360), s.alive ? 1 : 0);
      if (s.weapon && s.weapon !== lastWeapon) { row.weapons.push([r1(s.time), s.weapon]); lastWeapon = s.weapon; }
    }
    for (const s of t.radar) if (inRound(s.time) && s.alive) { const [x, y] = px(s.x, s.y); row.radar.push(r1(s.time), x, y); }
    for (const s of t.heard) if (inRound(s.time) && s.alive) { const [x, y] = px(s.x, s.y); row.heard.push(r1(s.time), x, y); }
    byName.set(p.name, row);
  }
  // Points from a reconnect's second connection come after the first: keep each list in time order.
  for (const row of byName.values()) {
    for (const [key, width] of [['seen', 5], ['radar', 3], ['heard', 3]] as const) {
      const flat = row[key];
      const groups: number[][] = [];
      for (let k = 0; k < flat.length; k += width) groups.push(flat.slice(k, k + width));
      groups.sort((a, b) => a[0] - b[0]);
      row[key] = groups.flat();
    }
    row.weapons.sort((a, b) => a[0] - b[0]);
  }
  const players = [...byName.values()].filter((p) => p.team && (p.seen.length || p.radar.length || p.heard.length || kills.some((k) => k.round === roundNo && (k.victim === p.name || k.killer === p.name))))
    .sort((a, b) => (a.team ?? '').localeCompare(b.team ?? '') || a.name.localeCompare(b.name));
  // Players with no position at all in this round still get a row (they show as "not seen").
  for (const k of kills) {
    if (k.round !== roundNo) continue;
    for (const [name, team] of [[k.victim, k.victimTeam], [k.killer, k.killerTeam]] as const) {
      if (team && name !== 'the world' && !players.some((p) => p.name === name)) players.push({ name, team, recorder: false, seen: [], radar: [], heard: [], weapons: [] });
    }
  }
  // Estimated positions (2.16) for the moments without a known one: only 'estimated' (between two known positions)
  // and 'held' (after the last one) points are sent; known points are already in seen/radar/heard.
  let estimates = false;
  if (est && (est.spawns.T.length || est.spawns.CT.length)) {
    estimates = true;
    const unit = Math.hypot(project(1, 0)[0] - project(0, 0)[0], project(1, 0)[1] - project(0, 0)[1]);
    for (const p of m.players) {
      const row = byName.get(p.name) ?? players.find((x) => x.name === p.name);
      if (!row || p.isHltv || (p.team !== 'T' && p.team !== 'CT')) continue;
      const track = m.tracks?.find((t) => t.player === p.id);
      const team = row.team ?? side(p.team);
      if (!team) continue;
      const lives = livesOf(p.id, { rounds: [r], kills: m.kills.filter((k) => k.round === roundNo).map((k) => ({ time: k.time, victim: k.victim })), deaths: m.deaths, track, spawns: est.spawns[team], leftAt: p.leftAt });
      for (const life of lives) {
        for (const e of estimateLife(est.walk, life, { step: 0.25 })) {
          if (e.source !== 'estimated' && e.source !== 'held') continue;
          const [x, y] = px(e.x, e.y);
          (row.est ??= []).push(r1(e.time), x, y, r1(e.radius * unit), Math.round(e.confidence * 100), e.source === 'held' ? 1 : 0, e.impossible ? 1 : 0);
        }
      }
    }
  }
  for (const row of players) {
    if (!row.est) continue;
    const groups: number[][] = [];
    for (let k = 0; k < row.est.length; k += 7) groups.push(row.est.slice(k, k + 7));
    row.est = groups.sort((a, b) => a[0] - b[0]).flat();
  }
  // The player standing near a point at a moment (for the bomb carrier).
  const seenNear = (t: number, x: number, y: number, maxDist: number, team?: 'T' | 'CT') => {
    let best: { name: string; team?: 'T' | 'CT'; d: number } | undefined;
    for (const row of players) {
      if (team && row.team !== team) continue;
      const s = row.seen;
      for (let k = 0; k < s.length; k += 5) {
        if (s[k + 4] !== 1 || Math.abs(s[k] - t) > 0.5) continue;
        const d = Math.hypot(s[k + 1] - x, s[k + 2] - y);
        if (d <= maxDist && (!best || d < best.d)) best = { name: row.name, team: row.team, d };
      }
    }
    return best;
  };
  const unitPx = Math.hypot(project(1, 0)[0] - project(0, 0)[0], project(1, 0)[1] - project(0, 0)[1]);
  // Grenades, with the thrower found the same way as on the Heatmaps tab (5.w).
  const throwers = new Map(grenadeThrows(m).map((g) => [g.index, g.thrower]));
  const grenades = (m.grenades ?? []).map((g, index) => ({ g, index })).filter(({ g }) => inRound(g.points[0].time)).map(({ g, index }) => {
    const points = g.points.flatMap((q) => { const [x, y] = px(q.x, q.y); return [r1(q.time), x, y]; });
    const id = throwers.get(index);
    const name = id === undefined ? undefined : m.players.find((p) => p.id === id)?.name;
    return { kind: g.kind, points, ...(name ? { thrower: name, team: sides.get(name)?.team ?? side(m.players.find((p) => p.id === id)?.team) } : {}) };
  });
  // Bomb carrier: who held the C4 in hand, who was standing at a drop when it was picked up, who planted it.
  const carrier: [number, number, string][] = [];
  const holderBy = (from: number, until: number): string | undefined => {
    // Seen with the C4 in hand in this stretch.
    for (const row of players) if (row.team === 'T' && row.weapons.some(([wt, w]) => w === 'c4' && wt >= from && wt <= until)) return row.name;
    return undefined;
  };
  let cur: { from: number; who?: string } | undefined = { from: start };
  let lastDrop: { x: number; y: number } | undefined;
  for (const b of m.bomb.filter((x) => inRound(x.time)).sort((x, y) => x.time - y.time)) {
    if (b.kind === 'dropped' || b.kind === 'planted') {
      const [x, y] = b.position ? px(b.position[0], b.position[1]) : [NaN, NaN];
      if (cur) {
        const who = cur.who ?? holderBy(cur.from, b.time) ?? (Number.isFinite(x) ? seenNear(b.time, x, y, 150 * unitPx, 'T')?.name : undefined);
        if (who) carrier.push([r1(cur.from), r1(b.time), who]);
      }
      lastDrop = Number.isFinite(x) ? { x, y } : undefined;
      cur = undefined;
      if (b.kind === 'planted') break;
    } else if (b.kind === 'picked up') {
      cur = { from: b.time, who: lastDrop ? seenNear(b.time, lastDrop.x, lastDrop.y, 150 * unitPx, 'T')?.name : undefined };
    }
  }
  if (cur) { const who = cur.who ?? holderBy(cur.from, end); if (who) carrier.push([r1(cur.from), r1(end), who]); }
  const bomb = m.bomb.filter((b) => inRound(b.time)).map((b) => {
    const e: ReplayData['bomb'][number] = { time: r1(b.time), kind: b.kind };
    if (b.position) [e.x, e.y] = px(b.position[0], b.position[1]);
    return e;
  });
  return {
    round: roundNo, start: r1(start), end: r1(end), freezeEnd: r.freezeEnd, roundEnd: r.end, winner: r.winner, reason: r.reason,
    players, kills: kills.filter((k) => k.round === roundNo), bomb, recording: m.recording, estimates, grenades, carrier, unitPx: r1(Math.hypot(project(1, 0)[0] - project(0, 0)[0], project(1, 0)[1] - project(0, 0)[1]) * 1000) / 1000,
  };
}
