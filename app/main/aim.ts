// 5.u Aim tab (POV): the recorder's reaction time, crosshair placement and shooting while moving, from his own client
// data (engine/src/match/aim.ts). Players are grouped by name (reconnects), as in the other tabs.
import { aimCoaching, aimSummary, DRAW_DELAY, type AimEngagement, type AimShot } from '../../engine/src/match/aim.js';
import type { Sight } from '../../engine/src/map/sight.js';
import type { MatchData } from '../../engine/src/match/types.js';
import type { AimPanel, AimSummaryData } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function summary(es: AimEngagement[], shots: AimShot[]): AimSummaryData {
  const s = aimSummary(es, shots);
  return {
    ...s,
    medianReaction: s.medianReaction === undefined ? undefined : r2(s.medianReaction),
    medianCrosshair: s.medianCrosshair === undefined ? undefined : r1(s.medianCrosshair),
    medianCrossV: es.length ? r1(median(es.map((e) => e.crossV))!) : undefined,
    medianCrossH: es.length ? r1(median(es.map((e) => e.crossH))!) : undefined,
  };
}

export function aimPanel(m: MatchData, sight?: Sight): AimPanel | undefined {
  if (m.recording !== 'POV' || !m.aim || m.recorderId === undefined) return undefined;
  const sides = playersByName(m);
  const me = m.players.find((p) => p.id === m.recorderId);
  const mine = me ? sides.get(me.name) : undefined;
  if (!me || !mine?.team) return undefined;
  const enemies = [...sides].filter(([, e]) => e.team && e.team !== mine.team);
  const nameOf = new Map<number, string>();
  for (const [name, e] of enemies) for (const id of e.ids) nameOf.set(id, name);
  const rep = aimCoaching({ aim: m.aim, rounds: m.rounds, kills: m.kills, recorder: mine.ids, enemies: enemies.flatMap(([, e]) => e.ids), sight });

  const byWeapon = new Map<string, AimShot[]>();
  for (const s of rep.shots) (byWeapon.get(s.weapon) ?? byWeapon.set(s.weapon, []).get(s.weapon)!).push(s);
  return {
    name: me.name,
    team: mine.team,
    method: rep.method,
    updateInterval: rep.updateInterval,
    margin: rep.margin,
    drawDelay: DRAW_DELAY,
    summary: summary(rep.engagements, rep.shots),
    engagements: rep.engagements.map((e) => {
      const r = m.rounds.find((x) => x.number === e.round);
      return {
        round: e.round, time: r2(e.time), clock: r1(e.time - (r?.freezeEnd ?? r?.start ?? 0)), enemy: nameOf.get(e.enemy) ?? '?',
        distance: e.distance, crosshair: e.crosshair, crossH: e.crossH, crossV: e.crossV,
        reaction: e.reaction, anticipated: e.anticipated, alreadyFiring: e.alreadyFiring, weapon: e.weapon, outcome: e.outcome,
      };
    }),
    weapons: [...byWeapon].map(([weapon, s]) => ({
      weapon, limit: s[0].limit, shots: s.length,
      accurate: s.filter((x) => x.state === 'accurate').length, moving: s.filter((x) => x.state === 'moving').length, air: s.filter((x) => x.state === 'air').length,
      medianMovingSpeed: (() => { const v = median(s.filter((x) => x.state === 'moving').map((x) => x.speed)); return v === undefined ? undefined : Math.round(v); })(),
    })).sort((a, b) => b.shots - a.shots),
    rounds: m.rounds.map((r) => ({ round: r.number, ...summary(rep.engagements.filter((e) => e.round === r.number), rep.shots.filter((s) => s.round === r.number)) })),
  };
}
