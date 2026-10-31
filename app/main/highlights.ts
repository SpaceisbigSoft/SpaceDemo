// 5.o Highlights: a list of moments worth watching, each with a jump into the Radar replay.
// HLTV demos: the HLTV director's own picks (event messages with a priority; it cuts to the spot about 4 s before
// the action: on the MoD HLTV demo 41 of 67 high-priority events had a kill 2–6 s later). All demos: multi-kills,
// quick double kills, clutches, knife kills.
import type { MatchData } from '../../engine/src/match/types.js';
import type { Highlight } from '../shared/api.js';
import { playersByName, statRows } from './details-extra.js';

/** Director events with at least this priority (0–15) count as highlights. */
export const DIRECTOR_MIN_PRIORITY = 7;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function highlights(m: MatchData): Highlight[] {
  const out: Highlight[] = [];
  const sides = playersByName(m);
  const nameOf = (id: number | null) => (id === null ? undefined : m.players.find((p) => p.id === id)?.name);
  const roundAt = (t: number) => m.rounds.find((r) => t >= r.start - 1 && t <= (m.rounds[m.rounds.indexOf(r) + 1]?.start ?? (r.end ?? r.start) + 5))?.number;
  // The player in a slot at a time (entity number = slot + 1); slots can be reused, so take the latest connection.
  const inSlot = (entity: number, t: number) => {
    const ps = m.players.filter((p) => p.slot === entity - 1 && !p.isHltv && (p.leftAt === undefined || p.leftAt >= t));
    return ps[ps.length - 1]?.name;
  };

  // HLTV director picks.
  let lastPick = -Infinity;
  for (const d of m.director) {
    if (d.type !== 2 || d.flags === undefined || (d.flags & 15) < DIRECTOR_MIN_PRIORITY) continue;
    if (m.liveStart !== undefined && d.time < m.liveStart) continue;
    if (d.time - lastPick < 8) continue;
    lastPick = d.time;
    const who = [d.entity1, d.entity2].filter((e): e is number => !!e && e <= 32).map((e) => inSlot(e, d.time)).filter((n): n is string => !!n);
    const round = roundAt(d.time);
    if (round === undefined) continue;
    out.push({ time: r1(d.time), round, kind: 'director', title: `HLTV director's pick${who.length ? `: ${[...new Set(who)].join(' vs ')}` : ''}`, players: [...new Set(who)], priority: d.flags & 15 });
  }

  // Multi-kills per round, and quick double kills.
  for (const r of m.rounds) {
    const ks = m.kills.filter((k) => k.round === r.number && k.killer !== null && !k.teamKill && !k.suicide).sort((a, b) => a.time - b.time);
    const by = new Map<string, typeof ks>();
    for (const k of ks) { const n = nameOf(k.killer)!; by.set(n, [...(by.get(n) ?? []), k]); }
    for (const [name, list] of by) {
      if (list.length >= 3) {
        const label = list.length >= 5 ? 'ace (5 kills)' : `${list.length} kills`;
        out.push({ time: r1(list[0].time), round: r.number, kind: 'multikill', title: `${name}: ${label} in ${Math.round(list[list.length - 1].time - list[0].time)} s`, players: [name], team: sides.get(name)?.team, priority: 8 + list.length });
      } else if (list.length === 2 && list[1].time - list[0].time <= 1.5) {
        out.push({ time: r1(list[0].time), round: r.number, kind: 'multikill', title: `${name}: quick double kill (${(list[1].time - list[0].time).toFixed(1)} s)`, players: [name], team: sides.get(name)?.team, priority: 7 });
      }
      for (const k of list) if (/knife/i.test(k.weapon)) out.push({ time: r1(k.time), round: r.number, kind: 'knife', title: `${name} knifed ${nameOf(k.victim)}`, players: [name, nameOf(k.victim)!], team: sides.get(name)?.team, priority: 9 });
    }
  }

  // Clutches won (1 vs 2 or more).
  for (const s of statRows(m)) {
    for (const c of s.clutches) {
      if (c.vs < 2) continue;
      const r = m.rounds.find((x) => x.number === c.round);
      if (!r) continue;
      const ks = m.kills.filter((k) => k.round === c.round).sort((a, b) => a.time - b.time);
      // From the moment he was left alone: the kill that left him alone.
      const alone = ks.find((k, i) => ks.slice(0, i + 1).length >= 1 && k.victimTeam === s.team && ks.slice(i + 1).every((x) => x.victimTeam !== s.team || nameOf(x.victim) === s.name));
      out.push({ time: r1(alone?.time ?? r.freezeEnd ?? r.start), round: c.round, kind: 'clutch', title: `${s.name} wins 1 vs ${c.vs}`, players: [s.name], team: s.team, priority: 9 + c.vs });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
