// 5.q Enemy sightings in a player's (POV) demo: what the recorder could know about the other team, round by round —
// when and where each enemy came into his view area (the server only sends players the recorder could see), what
// they held and whether they crouched, and the sounds they made (footsteps, getting hit…). Positions in picture pixels.
import type { Projection } from '../../engine/src/map/overview.js';
import type { MatchData } from '../../engine/src/match/types.js';
import type { Sight } from '../../engine/src/map/sight.js';
import type { SightEnemy, SightRound, SightingsData, SoundKind } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Sightings closer together than this are one sighting. */
const MERGE_GAP = 1;
/**
 * The server sends sounds from far away too. A sound counts as heard only within this distance of the recorder:
 * GoldSrc fades a normal-attenuation sound (footsteps) to nothing at about 1000 / 0.8 = 1250 units (Quake engine
 * rule, nominal clip distance 1000; not measured in game — an assumption to check).
 */
export const HEARING_RANGE = 1250;

/** What kind of sound it was, from the sound file name. */
export function soundKind(name: string): SoundKind {
  if (/^player\/pl_/i.test(name)) return 'step';
  if (/^player\/(bhit_|headshot)/i.test(name)) return 'hit';
  if (/^player\/(die|death)/i.test(name)) return 'death';
  if (/^(weapons|items)\//i.test(name)) return 'weapon';
  return 'other';
}

/** Half the recorder's horizontal field of view, plus a little for the enemy's body (CS default 90°). */
const HALF_FOV = 50;
/** Eye height above the origin of a standing player (CS view offset). */
const EYE = 17;

export function sightingsData(m: MatchData, project: Projection, bombSites: { letter: string; x: number; y: number }[] = [], sight?: Sight): SightingsData | undefined {
  if (m.recording !== 'POV' || m.recorderId === undefined || !m.tracks) return undefined;
  const sides = playersByName(m);
  const rec = m.players.find((p) => p.id === m.recorderId);
  const recTeam = rec ? sides.get(rec.name)?.team : undefined;
  if (!rec || !recTeam) return undefined;
  const px = (x: number, y: number) => { const [a, b] = project(x, y); return [r1(a), r1(b)] as const; };
  const nearSite = (x: number, y: number) => {
    let best: { letter: string; d: number } | undefined;
    for (const s of bombSites) { const d = Math.hypot(s.x - x, s.y - y); if (!best || d < best.d) best = { letter: s.letter, d }; }
    return best;
  };
  const unit = Math.hypot(project(1, 0)[0] - project(0, 0)[0], project(1, 0)[1] - project(0, 0)[1]);

  const enemies = [...sides].filter(([, e]) => e.team && e.team !== recTeam);
  // The recorder's own position (always known while he's alive), to tell which sounds he could hear.
  const recIds = sides.get(rec.name)?.ids ?? [rec.id];
  const recSeen = (m.tracks ?? []).filter((t) => recIds.includes(t.player)).flatMap((t) => t.seen).filter((p) => p.alive).sort((a, b) => a.time - b.time);
  const recAt = (t: number) => {
    let lo = 0, hi = recSeen.length - 1, best: (typeof recSeen)[number] | undefined;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (recSeen[mid].time <= t) { best = recSeen[mid]; lo = mid + 1; } else hi = mid - 1; }
    const next = recSeen[lo];
    const pick = [best, next].filter((p): p is NonNullable<typeof p> => !!p && Math.abs(p.time - t) <= 0.6).sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0];
    return pick;
  };
  const rounds: SightRound[] = m.rounds.map((r, i) => {
    const start = r.start, end = m.rounds[i + 1]?.start ?? (r.end ?? r.start) + 5;
    const live = r.freezeEnd ?? start;
    // Only while the recorder is alive: after he dies he watches his teammates, and that isn't what he knew.
    const recDied = m.kills.find((k) => recIds.includes(k.victim) && k.round === r.number)?.time ?? Infinity;
    const out: SightEnemy[] = [];
    for (const [name, e] of enemies) {
      const pts = (m.tracks ?? []).filter((t) => e.ids.includes(t.player));
      // In the view area (the server sent him); with the map, only when in the recorder's field of view with nothing
      // solid in between (head, chest or legs).
      const seen = pts.flatMap((t) => t.seen).filter((p) => {
        if (!p.alive || p.time < start || p.time > Math.min(end, recDied)) return false;
        if (!sight) return true;
        const me = recAt(p.time);
        if (!me) return false;
        if (me.yaw !== undefined) {
          const dir = (Math.atan2(p.y - me.y, p.x - me.x) * 180) / Math.PI;
          const diff = Math.abs((((dir - me.yaw) % 360) + 540) % 360 - 180);
          if (diff > HALF_FOV) return false;
        }
        const eye: [number, number, number] = [me.x, me.y, me.z + EYE];
        return [20, 0, -20].some((dz) => sight.clear(eye, [p.x, p.y, p.z + dz]));
      }).sort((a, b) => a.time - b.time);
      const heard = pts.flatMap((t) => t.heard).filter((p) => {
        if (p.time < start || p.time > Math.min(end, recDied)) return false;
        const me = recAt(p.time);
        return !!me && Math.hypot(me.x - p.x, me.y - p.y, me.z - p.z) <= HEARING_RANGE;
      }).sort((a, b) => a.time - b.time);
      const died = m.kills.find((k) => e.ids.includes(k.victim) && k.round === r.number)?.time;
      // Sightings: runs of seen points with gaps under a second.
      const spans: SightEnemy['seen'] = [];
      const path: number[] = [];
      let run: typeof seen = [];
      const flush = () => {
        if (!run.length) return;
        const weapons = new Map<string, number>();
        for (const p of run) if (p.weapon) weapons.set(p.weapon, (weapons.get(p.weapon) ?? 0) + 1);
        const weapon = [...weapons].sort((a, b) => b[1] - a[1])[0]?.[0];
        const crouch = run.filter((p) => p.crouch).length / run.length;
        const [x, y] = px(run[0].x, run[0].y);
        spans.push({ from: r1(run[0].time), to: r1(run[run.length - 1].time), weapon, crouch: Math.round(crouch * 100), x, y });
        let lastT = -Infinity;
        for (const p of run) if (p.time - lastT >= 0.5 || p === run[run.length - 1]) { const [a, b] = px(p.x, p.y); path.push(r1(p.time), a, b); lastT = p.time; }
        path.push(-1, -1, -1); // break between sightings
        run = [];
      };
      for (const p of seen) {
        if (run.length && p.time - run[run.length - 1].time > MERGE_GAP) flush();
        run.push(p);
      }
      flush();
      const sounds = heard.filter((h) => !seen.some((s) => Math.abs(s.time - h.time) < 0.3)).map((h) => {
        const [x, y] = px(h.x, h.y);
        return { time: r1(h.time), x, y, kind: soundKind(h.sound) };
      });
      if (!spans.length && !sounds.length && died === undefined) continue;
      out.push({ name, team: e.team!, seen: spans, sounds, path, died: died === undefined ? undefined : r1(died), seenSeconds: r1(spans.reduce((s, x) => s + (x.to - x.from), 0)) });
    }
    // First contact after freeze time: the earliest sighting or sound of any enemy (footsteps through a wall count).
    let first: SightRound['firstContact'];
    for (const en of out) {
      const s = en.seen.find((x) => x.to >= live);
      if (s && (!first || Math.max(s.from, live) < first.time)) first = { time: Math.max(s.from, live), name: en.name, how: 'seen', x: s.x, y: s.y, weapon: s.weapon };
      const h = en.sounds.find((x) => x.time >= live && x.kind !== 'death');
      if (h && (!first || h.time < first.time)) first = { time: h.time, name: en.name, how: 'heard', x: h.x, y: h.y, sound: h.kind };
    }
    if (first) {
      const site = nearSite(first.x, first.y);
      if (site && site.d / unit < 900) first.site = site.letter;
    }
    out.sort((a, b) => (a.seen[0]?.from ?? a.sounds[0]?.time ?? Infinity) - (b.seen[0]?.from ?? b.sounds[0]?.time ?? Infinity));
    return { round: r.number, start: r1(start), end: r1(end), recorderDied: Number.isFinite(recDied) ? r1(recDied) : undefined, freezeEnd: r.freezeEnd === undefined ? undefined : r1(r.freezeEnd), roundEnd: r.end === undefined ? undefined : r1(r.end), winner: r.winner, firstContact: first, enemies: out };
  });
  return { recorder: rec.name, team: recTeam, rounds, method: sight ? 'sight' : 'view-area' };
}
