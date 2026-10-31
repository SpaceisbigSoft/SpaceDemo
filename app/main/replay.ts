// 5.j 2D radar replay, step 1: everything one round needs to be replayed on the map — each player's known positions
// by source (seen = exact, radar = teammate on the radar, heard = a sound he made), weapon changes, kills and the bomb.
// Positions are in picture pixels (same projection as the heatmaps). Estimated positions (2.16) come in the next step.
import type { Projection } from '../../engine/src/map/overview.js';
import type { MatchData } from '../../engine/src/match/types.js';
import type { HeatKill, ReplayData, ReplayPlayer } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const side = (t: string | undefined): 'T' | 'CT' | undefined => (t === 'T' || t === 'CT' ? t : undefined);

/**
 * One round, from its start (freeze time) to the next round's start (or 5 s after its end). `kills` are the heatmap's
 * kills (killer and victim positions already in pixels).
 */
export function replayData(m: MatchData, project: Projection, kills: HeatKill[], roundNo: number): ReplayData | { error: string } {
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
  const bomb = m.bomb.filter((b) => inRound(b.time)).map((b) => {
    const e: ReplayData['bomb'][number] = { time: r1(b.time), kind: b.kind };
    if (b.position) [e.x, e.y] = px(b.position[0], b.position[1]);
    return e;
  });
  return {
    round: roundNo, start: r1(start), end: r1(end), freezeEnd: r.freezeEnd, roundEnd: r.end, winner: r.winner, reason: r.reason,
    players, kills: kills.filter((k) => k.round === roundNo), bomb, recording: m.recording,
  };
}
