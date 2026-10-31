// 5.n Recorder panel (POV): the recorder's own money, buys, health, damage taken, speed and the keys he pressed, round
// by round. Everything comes from his own client's data in the demo (plan 2.12 recorder data + his exact track).
import type { MatchData } from '../../engine/src/match/types.js';
import type { RecorderPanel } from '../shared/api.js';
import { playersByName } from './details-extra.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Buy time after the end of freeze time (CS default mp_buytime 1.5 minutes). */
const BUY_TIME = 90;
/** Faster than this (units/s) is a jump in position (respawn, spectator switch), not running. */
const MAX_SPEED = 400;

/** Key names as players know them (default keys). */
export const KEY_NAMES: Record<string, string> = {
  forward: 'W', back: 'S', moveleft: 'A', moveright: 'D', jump: 'Jump', duck: 'Duck', speed: 'Walk (Shift)',
  attack: 'Fire', attack2: 'Alt fire', reload: 'Reload', use: 'Use (E)', showscores: 'Scores (Tab)',
};

export function recorderPanel(m: MatchData): RecorderPanel | undefined {
  const rec = m.recorder;
  if (m.recording !== 'POV' || !rec || m.recorderId === undefined) return undefined;
  const me = m.players.find((p) => p.id === m.recorderId);
  if (!me) return undefined;
  const ids = playersByName(m).get(me.name)?.ids ?? [me.id];

  // Money: one value per moment (several messages at the same time: the last one counts).
  const money: [number, number][] = [];
  for (const x of rec.money) {
    if (money.length && Math.abs(money[money.length - 1][0] - x.time) < 0.05) money[money.length - 1] = [r1(x.time), x.money];
    else money.push([r1(x.time), x.money]);
  }
  const moneyAt = (t: number) => { let v: number | undefined; for (const [mt, mv] of money) { if (mt <= t) v = mv; else break; } return v; };
  const health: [number, number][] = rec.health.map((h) => [r1(h.time), h.health]);

  // Speed from his own exact track (about 10 positions a second), smoothed over half a second.
  const track = (m.tracks ?? []).filter((t) => ids.includes(t.player)).flatMap((t) => t.seen).filter((p) => p.alive).sort((a, b) => a.time - b.time);
  const speed: number[] = [];
  let lastOut = -Infinity;
  for (let i = 1; i < track.length; i++) {
    let j = i - 1;
    while (j > 0 && track[i].time - track[j].time < 0.5) j--;
    const dt = track[i].time - track[j].time;
    if (dt <= 0 || dt > 1) continue;
    const v = Math.hypot(track[i].x - track[j].x, track[i].y - track[j].y) / dt;
    if (v > MAX_SPEED) continue;
    if (track[i].time - lastOut >= 0.25) { speed.push(r1(track[i].time), Math.round(v)); lastOut = track[i].time; }
  }

  // Keys: pair each +key with its -key.
  const open = new Map<string, number>();
  const keys: [string, number, number][] = [];
  for (const k of rec.keys) {
    const mm = /^([+-])(\w+)/.exec(k.command);
    if (!mm || !KEY_NAMES[mm[2]]) continue;
    if (mm[1] === '+') { if (!open.has(mm[2])) open.set(mm[2], k.time); }
    else if (open.has(mm[2])) { keys.push([mm[2], r1(open.get(mm[2])!), r1(Math.max(k.time, open.get(mm[2])! + 0.05))]); open.delete(mm[2]); }
  }

  const rounds = m.rounds.map((r, i) => {
    const start = r.start, end = m.rounds[i + 1]?.start ?? (r.end ?? r.start) + 5;
    const live = r.freezeEnd ?? start;
    const startMoney = moneyAt(start + 0.5);
    // Spent = every drop in money during buy time (money only goes down by buying, or a team-kill fine).
    let spent = 0, prev = startMoney;
    for (const [mt, mv] of money) {
      if (mt <= start + 0.5 || mt > live + BUY_TIME) continue;
      if (prev !== undefined && mv < prev) spent += prev - mv;
      prev = mv;
    }
    const died = m.kills.find((k) => ids.includes(k.victim) && k.round === r.number)?.time;
    const weapons = [...new Set(rec.weapons.filter((w) => w.time >= start && w.time <= Math.min(end, died ?? Infinity)).map((w) => w.weapon))];
    const kills = m.kills.filter((k) => k.killer !== null && ids.includes(k.killer) && k.round === r.number && !k.teamKill && !k.suicide).length;
    const sp: number[] = [];
    for (let k = 0; k < speed.length; k += 2) if (speed[k] >= live && speed[k] <= Math.min(end, died ?? Infinity)) sp.push(speed[k + 1]);
    return {
      round: r.number, start: r1(start), end: r1(end), freezeEnd: r.freezeEnd === undefined ? undefined : r1(r.freezeEnd), winner: r.winner,
      startMoney, spent, endMoney: moneyAt(end - 0.5), weapons, kills, died: died === undefined ? undefined : r1(died),
      damage: rec.damageTaken.filter((d) => d.time >= start && d.time <= end).map((d) => ({ time: r1(d.time), amount: d.amount })),
      topSpeed: sp.length ? Math.max(...sp) : undefined,
      avgSpeed: sp.length ? Math.round(sp.reduce((a, b) => a + b, 0) / sp.length) : undefined,
    };
  });
  return { name: me.name, money, health, speed, keys, rounds, weapons: rec.weapons.map((w) => [r1(w.time), w.weapon] as [number, string]) };
}
