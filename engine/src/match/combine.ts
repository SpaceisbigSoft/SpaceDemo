// 5.r Combine demos of the same match. Recordings of the same game (several players' POV demos and/or HLTV) each
// have their own clock: demo time starts when that recording started. They are lined up on what every recording
// shows the same way, the kill feed (killer, victim, weapon, in order) and the round ends, then the positions one
// recording knows are added to another: an HLTV demo knows where everyone is, a POV demo only what its recorder's
// view area holds. Players are matched by name (server user ids differ between recordings). Only reads data.
import type { Grenade, MatchData, PlayerTrack, TrackPoint } from './types.js';

/** How one recording's clock lines up with another's: other time + offset = base time. */
export interface Alignment {
  offset: number;
  /** Kills found in both recordings, in the same order. */
  matched: number;
  /** Kills in the base recording / in the other one. */
  baseKills: number;
  otherKills: number;
  /** Matched kills that agree with the offset within 1 s (the others are dropped as chance matches). */
  consistent: number;
  /** After lining up: largest and median gap between the same kill in both (seconds). */
  maxGap: number;
  medianGap: number;
  /** Round ends found in both (same winner, within 1 s after lining up). */
  roundEnds: number;
  /** Rounds of the base recording that the other one also covers (by round end). */
  sharedRounds: number[];
  /** Offset per base round (recordings can jump a fraction of a second mid-match, e.g. after a lag spike): rounds
   *  with matched kills get their own median, the others the overall offset. Base times. */
  segments: { from: number; offset: number }[];
}

/** Base time of a moment in the other recording (per-round offset). */
export function toBase(al: Pick<Alignment, 'offset' | 'segments'>, otherTime: number): number {
  const rough = otherTime + al.offset;
  let off = al.offset;
  for (const s of al.segments) { if (s.from <= rough) off = s.offset; else break; }
  return otherTime + off;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const nameOf = (m: MatchData) => {
  const byId = new Map(m.players.map((p) => [p.id, p.name]));
  return (id: number | null) => (id === null ? '(world)' : byId.get(id) ?? `#${id}`);
};

function killKeys(m: MatchData): { key: string; time: number }[] {
  const n = nameOf(m);
  return m.kills.map((k) => ({ key: `${n(k.killer)}>${n(k.victim)}>${k.weapon}`, time: k.time }));
}

/**
 * Lines up `other` with `base`. Kills are paired in order (longest common sequence of killer>victim>weapon), the clock
 * offset is the median of the pairs, and pairs more than 1 s away from it are dropped. Returns undefined when fewer
 * than `minKills` kills agree (not the same match, or too little in common).
 */
export function alignMatches(base: MatchData, other: MatchData, minKills = 6): Alignment | undefined {
  if (base.map !== other.map) return undefined;
  const a = killKeys(base), b = killKeys(other);
  // Longest common subsequence of the kill keys (kill feeds are a few hundred lines at most).
  const L: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      L[i][j] = a[i].key === b[j].key ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].key === b[j].key) { pairs.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  if (pairs.length < minKills) return undefined;
  const offs = pairs.map(([i, j]) => a[i].time - b[j].time);
  const med = median(offs);
  const goodPairs = pairs.filter((_, k) => Math.abs(offs[k] - med) < 1);
  const good = goodPairs.map(([i, j]) => a[i].time - b[j].time);
  if (good.length < minKills) return undefined;
  const offset = median(good);
  // Per round of the base recording: the median of that round's kills.
  const segments: { from: number; offset: number }[] = [];
  const starts = base.rounds.map((r) => r.start);
  for (let r = 0; r < starts.length; r++) {
    const from = r === 0 ? -Infinity : starts[r], to = starts[r + 1] ?? Infinity;
    const inRound = goodPairs.filter(([i]) => a[i].time >= from && a[i].time < to).map(([i, j]) => a[i].time - b[j].time);
    segments.push({ from, offset: inRound.length ? median(inRound) : offset });
  }
  if (!segments.length) segments.push({ from: -Infinity, offset });
  const al0 = { offset, segments };
  const gaps = goodPairs.map(([i, j]) => Math.abs(toBase(al0, b[j].time) - a[i].time));

  // Round ends: the same winner within 1 s once lined up.
  const sharedRounds: number[] = [];
  for (const r of base.rounds) {
    if (r.end === undefined) continue;
    const hit = other.rounds.find((o) => o.end !== undefined && o.winner === r.winner && Math.abs(toBase(al0, o.end) - r.end!) < 1);
    if (hit) sharedRounds.push(r.number);
  }
  return {
    offset, matched: pairs.length, baseKills: a.length, otherKills: b.length, consistent: good.length,
    maxGap: Math.max(...gaps), medianGap: median(gaps), roundEnds: sharedRounds.length, sharedRounds, segments,
  };
}

/** True when the alignment says both are recordings of the same rounds (not just the same players on the same map). */
export function sameRounds(al: Alignment | undefined): boolean {
  return !!al && al.consistent >= 6 && al.roundEnds >= 2 && al.consistent >= 0.5 * Math.min(al.baseKills, al.otherKills);
}

export interface Contribution {
  /** Positions added per source (points). */
  seen: number;
  radar: number;
  heard: number;
  grenades: number;
  deaths: number;
  /** Players the base recording never saw at all, now with positions. */
  newPlayers: string[];
}

/**
 * The base recording with the positions of the other recordings added (in the base recording's clock). Players are
 * matched by name; a name the base doesn't know is added as a new player. Kills, rounds, chat and everything else stay
 * the base recording's own. Only times inside the base recording are kept. Returns a new object; inputs are unchanged.
 */
export function mergeMatches(base: MatchData, others: { m: MatchData; align: Pick<Alignment, 'offset' | 'segments'> }[]): { m: MatchData; added: Contribution[] } {
  const players = base.players.map((p) => ({ ...p }));
  const tracks = new Map<number, PlayerTrack>((base.tracks ?? []).map((t) => [t.player, { player: t.player, seen: [...t.seen], radar: [...t.radar], heard: [...t.heard] }]));
  const grenades: Grenade[] = [...(base.grenades ?? [])];
  const deaths = [...base.deaths];
  const lastTime = Math.max(base.rounds.at(-1)?.end ?? 0, ...base.kills.map((k) => k.time), ...base.chat.map((c) => c.time), 0) + 10;
  let nextId = Math.max(0, ...players.map((p) => p.id)) + 1000;
  // Names with positions in the base recording (to tell which players are new).
  const hadPositions = new Set([...tracks.values()].filter((t) => t.seen.length || t.radar.length || t.heard.length).map((t) => players.find((p) => p.id === t.player)?.name));
  const added: Contribution[] = [];

  for (const { m, align } of others) {
    const c: Contribution = { seen: 0, radar: 0, heard: 0, grenades: 0, deaths: 0, newPlayers: [] };
    // Base id for each of the other recording's players (by name; reconnects share a name and land on the same row).
    const idOf = new Map<number, number>();
    for (const p of m.players) {
      if (p.isHltv || !p.name) continue;
      // Prefer the connection that played on the same team (a reconnect leaves an earlier one with no team).
      const same = players.filter((x) => !x.isHltv && x.name === p.name);
      let bp = same.find((x) => x.team === p.team && (x.team === 'T' || x.team === 'CT'))
        ?? same.find((x) => x.team === 'T' || x.team === 'CT') ?? same[0];
      if (!bp) {
        bp = { ...p, id: nextId++, isRecorder: false, shots: {}, slot: -1 };
        players.push(bp);
      }
      idOf.set(p.id, bp.id);
    }
    const inside = (t: number) => t >= 0 && t <= lastTime;
    const shift = <T extends { time: number }>(pt: T): T => ({ ...pt, time: Math.round(toBase(align, pt.time) * 1000) / 1000 });
    for (const t of m.tracks ?? []) {
      const id = idOf.get(t.player);
      if (id === undefined) continue;
      const row = tracks.get(id) ?? (tracks.set(id, { player: id, seen: [], radar: [], heard: [] }).get(id)!);
      const before = row.seen.length + row.radar.length + row.heard.length;
      for (const key of ['seen', 'radar', 'heard'] as const) {
        const add = (t[key] as TrackPoint[]).map(shift).filter((p) => inside(p.time));
        const list = row[key] as TrackPoint[];
        const merged = mergeSorted(list, add, key === 'seen' ? 0.04 : 0.2);
        c[key] += merged.length - list.length;
        (row as unknown as Record<string, TrackPoint[]>)[key] = merged;
      }
      const name = players.find((p) => p.id === id)?.name;
      if (before === 0 && row.seen.length + row.radar.length + row.heard.length > 0 && name && !hadPositions.has(name) && !c.newPlayers.includes(name)) c.newPlayers.push(name);
    }
    for (const g of m.grenades ?? []) {
      const pts = g.points.map(shift).filter((p) => inside(p.time));
      if (pts.length < 2) continue;
      const end = pts.at(-1)!;
      // The same grenade seen by both: same kind, ends within 0.5 s and 64 units.
      const dup = grenades.some((h) => h.kind === g.kind && h.points.length && Math.abs(h.points.at(-1)!.time - end.time) < 0.5
        && Math.hypot(h.points.at(-1)!.x - end.x, h.points.at(-1)!.y - end.y) < 64);
      if (!dup) { grenades.push({ kind: g.kind, points: pts }); c.grenades++; }
    }
    for (const d of m.deaths) {
      const time = toBase(align, d.time);
      if (!inside(time)) continue;
      const victim = d.victim === undefined ? undefined : idOf.get(d.victim);
      // Same body: within 1 s and 48 units, or the same victim within 3 s.
      const dup = deaths.some((x) => (Math.abs(x.time - time) < 1 && Math.hypot(x.position[0] - d.position[0], x.position[1] - d.position[1]) < 48)
        || (victim !== undefined && x.victim === victim && Math.abs(x.time - time) < 3));
      if (dup) continue;
      const round = base.rounds.find((r) => time >= r.start && time <= (r.end ?? r.start) + 6)?.number;
      deaths.push({ ...d, time, victim, round });
      c.deaths++;
    }
    added.push(c);
  }
  deaths.sort((a, b) => a.time - b.time);
  grenades.sort((a, b) => a.points[0].time - b.points[0].time);
  return { m: { ...base, players, tracks: [...tracks.values()], grenades, deaths }, added };
}

/** Both lists in time order; points of `add` closer than `gap` seconds to a point already in `list` are left out. */
function mergeSorted(list: TrackPoint[], add: TrackPoint[], gap: number): TrackPoint[] {
  if (!add.length) return list;
  const out: TrackPoint[] = [];
  let i = 0, j = 0;
  const sortedAdd = [...add].sort((a, b) => a.time - b.time);
  while (i < list.length || j < sortedAdd.length) {
    if (j >= sortedAdd.length || (i < list.length && list[i].time <= sortedAdd[j].time)) { out.push(list[i++]); continue; }
    const p = sortedAdd[j++];
    const prev = out.at(-1), next = list[i];
    if ((prev && p.time - prev.time < gap) || (next && next.time - p.time < gap)) continue;
    out.push(p);
  }
  return out;
}

/** One match half or a whole match: recordings grouped (5.r). */
export interface MatchGroupInput { key: string; m: MatchData; recording: 'POV' | 'HLTV'; date: number }

/** The other half of a match: same map, mostly the same players, the teams swapped sides, recorded close in time. */
export function otherHalf(a: MatchData, b: MatchData): boolean {
  // A few completed rounds at least (a short warm-up recording isn't a half).
  if (a.map !== b.map || a.rounds.length < 3 || b.rounds.length < 3) return false;
  const side = (m: MatchData) => {
    const out = new Map<string, string>();
    for (const p of m.players) if (!p.isHltv && p.name && (p.team === 'T' || p.team === 'CT')) out.set(p.name, p.team);
    return out;
  };
  const sa = side(a), sb = side(b);
  let swapped = 0, same = 0;
  for (const [n, t] of sa) { const u = sb.get(n); if (!u) continue; if (u === t) same++; else swapped++; }
  return swapped >= 6 && swapped > 2 * same;
}

/**
 * Share of the time players were alive in a round (freeze end → round end, until they died) during which the
 * recording knows where they are: a seen, radar or heard position within `within` seconds. 0–1, plus the seconds.
 */
export function positionCoverage(m: MatchData, within = 1): { known: number; alive: number; share: number } {
  let known = 0, alive = 0;
  const byName = new Map<string, number[]>();
  const played = new Set(m.players.filter((p) => p.team === 'T' || p.team === 'CT').map((p) => p.name));
  for (const p of m.players) if (!p.isHltv && p.name && played.has(p.name)) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);
  const times = new Map<string, number[]>();
  for (const [name, ids] of byName) {
    const ts: number[] = [];
    for (const t of m.tracks ?? []) if (ids.includes(t.player)) for (const k of ['seen', 'radar', 'heard'] as const) for (const p of t[k]) if (p.alive) ts.push(p.time);
    times.set(name, ts.sort((a, b) => a - b));
  }
  const nameOfId = new Map(m.players.map((p) => [p.id, p.name]));
  for (const r of m.rounds) {
    const from = r.freezeEnd ?? r.start, to = r.end;
    if (to === undefined || to <= from) continue;
    // Players of this round: the ones with a position or a kill/death in it.
    for (const [name, ts] of times) {
      const died = m.kills.find((k) => k.time >= from && k.time <= to && nameOfId.get(k.victim) === name)?.time ?? to;
      const inRound = ts.some((t) => t >= from - 15 && t <= to) || died < to;
      if (!inRound) continue;
      for (let t = from; t < died; t += 1) {
        alive++;
        // Binary search for a time within `within` seconds.
        let lo = 0, hi = ts.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] < t - within) lo = mid + 1; else hi = mid; }
        if (lo < ts.length && ts[lo] <= t + within) known++;
      }
    }
  }
  return { known, alive, share: alive ? known / alive : 0 };
}
