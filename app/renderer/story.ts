// 5.y Round story: a short plain-English summary of each round from the details already worked out (kills, alive
// counts, bomb, clutches, comebacks, where the opening kill and the plant were), e.g.
// "MoD opened: Tang.MoD killed :i69:Guido at 0:24 near A. i69 planted B at 0:58 (4v3). MoD retook 3v2 and defused."
// Routes ("rushed", "split") need 5.x; until then the story names the site and the timing.
import type { DemoDetails, RoundDetail } from '../shared/api.js';
import { formatLength } from './format.js';

const at = (s: number) => formatLength(Math.max(0, s));
type Side = 'T' | 'CT';

/** Alive counts (T, CT) just after `t` seconds into the round. */
function aliveAt(r: RoundDetail, t: number): { T: number; CT: number } {
  let cur = { T: r.alive.T, CT: r.alive.CT };
  for (const s of r.alive.steps) if (s.at <= t + 0.05) cur = { T: s.T, CT: s.CT }; else break;
  return cur;
}
const vs = (a: { T: number; CT: number }, first: Side) => (first === 'T' ? `${a.T} v ${a.CT}` : `${a.CT} v ${a.T}`);

/** Nearest bomb site letter to a point in picture pixels, only when clearly nearer to it than to any other site. */
export function nearSite(sites: { letter: string; x: number; y: number }[], x: number, y: number): string | undefined {
  if (!sites.length) return undefined;
  const ds = sites.map((s) => ({ letter: s.letter, d: Math.hypot(s.x - x, s.y - y) })).sort((a, b) => a.d - b.d);
  if (ds.length === 1) return undefined;
  return ds[0].d < ds[1].d * 0.5 ? ds[0].letter : undefined;
}

export function roundStory(d: DemoDetails, r: RoundDetail, tags: { T: string; CT: string }): string {
  const parts: string[] = [];
  let toldComeback = false;
  const heatKills = d.heatmap.kills.filter((k) => k.round === r.number && !k.teamKill && !k.suicide).sort((a, b) => a.time - b.time);
  const sites = d.heatmap.sites;

  // Pistol rounds: the first round of each half (score 0 : 0 before it, or right after a 15-round half).
  const i = d.roundDetails.indexOf(r);
  if (r.number === 1 || (i > 0 && (r.scoreT ?? -1) + (r.scoreCT ?? -1) === 1)) parts.push('Pistol round.');

  // 5.s The first time anyone saw an enemy.
  const fs = d.sightlines?.firsts.find((f) => f.round === r.number);
  if (fs) {
    const t0 = d.periods.find((p) => p.round === r.number);
    const rel = fs.time - (t0?.freezeEnd ?? t0?.start ?? fs.time);
    parts.push(`First sight at ${at(rel)}: ${fs.mutual ? `${fs.seer} and ${fs.seen} saw each other` : `${fs.seer} saw ${fs.seen}`}.`);
  }

  // Opening kill, and where.
  const first = r.kills.find((k) => !k.teamKill && k.killer !== k.victim && k.killerTeam);
  if (first) {
    const hk = heatKills.find((k) => k.killer === first.killer && k.victim === first.victim);
    const where = hk ? nearSite(sites, hk.vx, hk.vy) : undefined;
    parts.push(`${tags[first.killerTeam!]} opened: ${first.killer} killed ${first.victim} at ${at(first.at)}${where ? ` near ${where}` : ''}${first.headshot ? ' (headshot)' : ''}.`);
  }

  // The plant: where, when, and the numbers then.
  if (r.plantedAt !== undefined) {
    const plant = d.heatmap.plants.find((p) => p.round === r.number);
    const a = aliveAt(r, r.plantedAt);
    parts.push(`${tags.T} planted ${plant?.site ? `at ${plant.site}` : 'the bomb'} at ${at(r.plantedAt)}, ${vs(a, 'T')} alive.`);
  }

  // How it ended.
  const w = r.winner === 'T' || r.winner === 'CT' ? r.winner : undefined;
  const last = r.alive.steps.at(-1) ?? r.alive;
  if (r.reason === 'bomb defused' && r.bombEnd) {
    const a = aliveAt(r, r.plantedAt ?? r.bombEnd.at);
    const behind = r.plantedAt !== undefined && a.CT < a.T ? ` from ${vs(a, 'CT')} down` : '';
    if (behind && a.T - a.CT >= 2) toldComeback = true;
    parts.push(`${tags.CT} retook${behind} and defused at ${at(r.bombEnd.at)}${r.bombTimer !== undefined ? `, ${Math.round(r.bombTimer)} s after the plant` : ''}.`);
  } else if (r.reason === 'bomb exploded') {
    parts.push(`The bomb exploded at ${at(r.bombEnd?.at ?? r.seconds)}${last.CT > 0 ? ` with ${last.CT} CT${last.CT > 1 ? 's' : ''} still alive` : ''}.`);
  } else if (r.reason === 'time ran out') {
    parts.push(`${tags.CT} held: time ran out with no plant.`);
  } else if (w && (r.reason === 'eliminated' || r.reason === undefined)) {
    const lastKill = [...r.kills].reverse().find((k) => !k.teamKill);
    const after = r.plantedAt !== undefined && w === 'CT' ? ' after the plant' : '';
    const left = last[w] === 1 ? 'with 1 player left' : `with ${last[w]} players left`;
    parts.push(`${tags[w]} won${after} ${left}${lastKill ? `, last kill at ${at(lastKill.at)}` : ''}.`);
  } else if (w) {
    parts.push(`${tags[w]} won.`);
  }

  // Standout moments: a clutch, a comeback, 3+ kills by one player.
  const clutch = d.stats.flatMap((s) => s.clutches.filter((c) => c.round === r.number && c.vs >= 2).map((c) => ({ name: s.name, vs: c.vs })))[0];
  if (clutch) parts.push(`${clutch.name} won it alone, 1 v ${clutch.vs}.`);
  const back = d.momentum.comebacks.find((c) => c.round === r.number);
  if (back && !clutch && !toldComeback) parts.push(`${tags[back.side]} came back from ${back.down} players down.`);
  const by = new Map<string, number>();
  for (const k of r.kills) if (!k.teamKill && k.killer !== k.victim && k.killerTeam) by.set(k.killer, (by.get(k.killer) ?? 0) + 1);
  const top = [...by].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) parts.push(`${top[0]} got ${top[1] >= 5 ? 'an ace' : `${top[1]} kills`}.`);
  // A side that never lost a player.
  if (w && r.kills.length >= 3 && r.alive.steps.every((s) => s[w] === r.alive[w])) parts.push(`${tags[w]} lost nobody.`);
  return parts.join(' ');
}
