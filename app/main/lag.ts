// 5.z Lag view: each player's scoreboard ping over the demo, the recorder's choke and lost packets, and the laggy
// moments worth a look. Only reads the match data.
import type { MatchData } from '../../engine/src/match/types.js';
import type { LagData, LagMoment, LagPlayer } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

/** A ping this high above the player's usual one counts as a spike (and at least this many ms). */
export const SPIKE_OVER = 100;
export const SPIKE_MIN = 150;
/** Packets lost / choked within LAG_WINDOW seconds that make a laggy moment for the recorder. */
export const LOST_IN_WINDOW = 5;
export const CHOKE_IN_WINDOW = 5;
const LAG_WINDOW = 2;
/** Moments of the same kind for the same player closer than this are one moment. */
const MERGE = 10;

export function lagData(m: MatchData, seconds: number): LagData {
  const net = m.net ?? { pings: [], choke: [], lost: [] };
  const sides = playersByName(m);
  const nameOf = new Map(m.players.map((p) => [p.id, p.name]));
  const hltv = new Set(m.players.filter((p) => p.isHltv).map((p) => p.id));
  const roundAt = (t: number) => m.rounds.find((r) => t >= r.start && t <= (r.end ?? r.start) + 5)?.number;
  const moments: LagMoment[] = [];
  const addMoment = (x: LagMoment) => {
    const prev = [...moments].reverse().find((y) => y.kind === x.kind && y.who === x.who);
    if (prev && x.time - prev.end <= MERGE) { prev.end = x.time; prev.worst = Math.max(prev.worst, x.worst); return; }
    moments.push(x);
  };

  // Pings per player (by name: reconnects add up).
  const byName = new Map<string, { time: number; ping: number; loss: number }[]>();
  for (const p of net.pings) {
    if (hltv.has(p.player)) continue;
    const name = nameOf.get(p.player);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  const players: LagPlayer[] = [];
  for (const [name, list] of byName) {
    list.sort((a, b) => a.time - b.time);
    const pings = list.map((x) => x.ping);
    const med = median(pings);
    const limit = Math.max(SPIKE_MIN, med + SPIKE_OVER, 2 * med);
    let spikes = 0;
    for (const x of list) {
      if (x.ping < limit) continue;
      spikes++;
      addMoment({ time: r1(x.time), end: r1(x.time), round: roundAt(x.time), kind: 'ping', who: name, worst: x.ping });
    }
    players.push({
      name, team: sides.get(name)?.team, recorder: sides.get(name)?.recorder ?? false,
      samples: list.length, median: med, p95: pct(pings, 0.95), max: Math.max(...pings),
      loss: Math.round((list.reduce((a, x) => a + x.loss, 0) / list.length) * 10) / 10, spikes,
      pings: list.flatMap((x) => [r1(x.time), x.ping]),
    });
  }
  players.sort((a, b) => (a.team ?? 'Z').localeCompare(b.team ?? 'Z') || a.name.localeCompare(b.name));

  // The recorder's connection (POV): lost packets and choke within a short window.
  let recorder: LagData['recorder'];
  if (m.recording === 'POV') {
    const name = m.players.find((p) => p.id === m.recorderId)?.name ?? 'the recorder';
    const window = <T>(list: T[], time: (x: T) => number, weight: (x: T) => number, need: number, kind: 'lost' | 'choke') => {
      for (let i = 0, j = 0, sum = 0; i < list.length; i++) {
        sum += weight(list[i]);
        while (time(list[i]) - time(list[j]) > LAG_WINDOW) sum -= weight(list[j++]);
        if (sum >= need) addMoment({ time: r1(time(list[j])), end: r1(time(list[i])), round: roundAt(time(list[i])), kind, who: name, worst: sum });
      }
    };
    window(net.lost, (x) => x.time, (x) => x.packets, LOST_IN_WINDOW, 'lost');
    window(net.choke, (x) => x, () => 1, CHOKE_IN_WINDOW, 'choke');
    recorder = {
      name, choke: net.choke.map(r1), lost: net.lost.flatMap((x) => [r1(x.time), x.packets]),
      lostTotal: net.lost.reduce((a, x) => a + x.packets, 0),
    };
  }
  moments.sort((a, b) => a.time - b.time);
  return {
    seconds, players, recorder, moments,
    rounds: m.rounds.map((r) => ({ number: r.number, start: r1(r.freezeEnd ?? r.start), end: r1(r.end ?? r.start) })),
    liveStart: m.liveStart,
    pingsWhenScoreboardOpen: m.recording === 'POV',
  };
}
