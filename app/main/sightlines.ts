// 5.s Who could see whom (engine/src/match/sightlines.ts) for the details page: kills through walls and from behind
// (as highlights), the first sight of each round (round story) and how often the player who saw the other first won.
import { sightlines } from '../../engine/src/match/sightlines.js';
import type { Sight } from '../../engine/src/map/sight.js';
import type { MatchData } from '../../engine/src/match/types.js';
import type { Highlight, SightlineData } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Saw the other this much earlier (s) to count as "saw first". */
const FIRST_BY = 0.15;

export function sightlineData(m: MatchData, sight?: Sight): SightlineData | undefined {
  if (!sight || !m.tracks) return undefined;
  const sides = playersByName(m);
  const team = new Map<number, 'T' | 'CT'>();
  const nameOf = new Map<number, string>();
  for (const [name, e] of sides) for (const id of e.ids) { nameOf.set(id, name); if (e.team) team.set(id, e.team); }
  const r = sightlines({ tracks: m.tracks, kills: m.kills, rounds: m.rounds, team, sight });
  const n = (id: number) => nameOf.get(id) ?? '?';
  const known = r.kills.filter((k) => k.known);
  let fights = 0, won = 0;
  for (const k of known) {
    const ks = k.killerSaw ?? -1, vs = k.victimSaw ?? -1;
    if (Math.abs(ks - vs) < FIRST_BY) continue;
    fights++;
    if (ks > vs) won++;
  }
  return {
    kills: r.kills.map((k) => ({ time: r1(k.time), round: k.round, killer: n(k.killer), victim: n(k.victim), known: k.known, clear: k.clear, offView: k.offView, killerSaw: k.killerSaw, victimSaw: k.victimSaw })),
    firsts: r.firsts.map((f) => ({ round: f.round, time: r1(f.time), seer: n(f.seer), seen: n(f.seen), mutual: f.mutual })),
    sawFirst: { fights, won },
    known: known.length,
    total: r.kills.length,
  };
}

/** Highlights from the sight lines: kills with no clear line (through a wall, door or box) and kills from behind. */
export function sightHighlights(s: SightlineData | undefined, m: MatchData): Highlight[] {
  if (!s) return [];
  const sides = playersByName(m);
  const out: Highlight[] = [];
  for (const k of s.kills) {
    if (!k.known || k.round === undefined) continue;
    const team = sides.get(k.killer)?.team;
    if (k.clear === false) out.push({ time: k.time, round: k.round, kind: 'wallbang', title: `${k.killer} killed ${k.victim} with no clear line (through a wall, door or box?)`, players: [k.killer, k.victim], team, priority: 9 });
    else if ((k.offView ?? 0) > 110) out.push({ time: k.time, round: k.round, kind: 'behind', title: `${k.killer} killed ${k.victim} from behind`, players: [k.killer, k.victim], team, priority: 8 });
  }
  return out;
}
