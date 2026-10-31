// 5.l chat and radio log, 5.m voice timeline: periods, chat channels, radio kinds, bursts per player (no demos needed).
import { describe, expect, it } from 'vitest';
import type { MatchData } from '../../engine/src/match/types.js';
import { chatRadioLog, periods, voiceTimeline } from '../main/details-extra.js';

const player = (id: number, slot: number, name: string, team: 'T' | 'CT' | 'SPECTATOR') =>
  ({ id, slot, name, names: [name], team, isHltv: false, isRecorder: false, shots: {} });

const m: MatchData = {
  map: 'de_train', recording: 'POV', restarts: 0,
  players: [player(1, 0, 'Alpha', 'T'), player(2, 1, 'Bravo', 'CT'), player(3, 2, 'Watcher', 'SPECTATOR'), player(4, 3, 'Alpha', 'T')],
  rounds: [
    { number: 1, start: 100, freezeEnd: 105, end: 200, winner: 'CT', reason: 'eliminated' },
    { number: 2, start: 205, freezeEnd: 210, end: 300, winner: 'T', reason: 'bomb exploded' },
  ],
  kills: [], deaths: [], bomb: [], director: [],
  chat: [
    { time: 10, sender: 1, text: 'Alpha :    gl hf', teamOnly: false, dead: false },
    { time: 120, sender: 1, text: '(Terrorist) Alpha :   rush b', teamOnly: true, dead: false },
    { time: 150, sender: 2, text: '*DEAD*(CT) Bravo :   one left', teamOnly: false, dead: true },
    { time: 151, sender: 2, text: '*DEAD* Bravo :   nice', teamOnly: false, dead: true },
    { time: 152, sender: 3, text: '*SPEC* Watcher :   wow', teamOnly: false, dead: false },
    { time: 153, text: '<Some Viewer> lol', teamOnly: false, dead: false },
    { time: 50, text: '<CAL CS Match Server> CAL config file has been executed"', teamOnly: false, dead: false },
    { time: 310, sender: 4, text: 'Alpha :    gg', teamOnly: false, dead: false },
  ],
  radio: [
    { time: 30, sender: 1, message: 'LOCKNLOAD' },
    { time: 105.2, sender: 1, message: 'GO' },
    { time: 130, sender: 1, message: 'GO' },
    { time: 131, sender: 1, message: 'ROGER' },
    { time: 132, sender: 4, message: 'ROGER' },
    { time: 140, sender: 2, message: 'FIREINHOLE' },
    { time: 200, message: 'ctwin' },
    { time: 260, sender: 2, message: 'SOMETHINGNEW' },
  ],
  voice: [
    { player: 1, slot: 0, start: 20, end: 22, packets: 44 },
    { player: 4, slot: 3, start: 120, end: 121, packets: 22 },
    { player: 2, slot: 1, start: 130, end: 135, packets: 110 },
    { slot: 5, start: 140, end: 141, packets: 22 },
  ],
};

describe('5.l and 5.m', () => {
  const ps = periods(m, 312);

  it('splits the demo into warm-up, rounds and after the match', () => {
    expect(ps.map((p) => [p.id, p.start, p.end])).toEqual([['warmup', 0, 100], ['r1', 100, 205], ['r2', 205, 305], ['after', 305, 312]]);
    expect(ps[1]).toMatchObject({ round: 1, freezeEnd: 105, roundEnd: 200, winner: 'CT' });
    expect(periods({ ...m, rounds: [] }, 312)).toEqual([{ id: 'all', label: 'Whole demo', start: 0, end: 312 }]);
  });

  it('gives each chat line its channel and plain text', () => {
    const { log } = chatRadioLog(m, ps);
    const chat = log.filter((e) => e.kind === 'chat');
    expect(chat.map((e) => [e.channel, e.who, e.text, e.period])).toEqual([
      ['all', 'Alpha', 'gl hf', 'warmup'],
      ['server', undefined, 'CAL config file has been executed', 'warmup'],
      ['team', 'Alpha', 'rush b', 'r1'],
      ['dead-team', 'Bravo', 'one left', 'r1'],
      ['dead', 'Bravo', 'nice', 'r1'],
      ['spectator', 'Watcher', 'wow', 'r1'],
      ['hltv', 'Some Viewer', 'lol', 'r1'],
      ['all', 'Alpha', 'gg', 'after'],
    ]);
    expect(chat.find((e) => e.who === 'Bravo')?.team).toBe('CT');
  });

  it('tells radio menu calls from automatic ones and counts them per player', () => {
    const { log, radioByPlayer } = chatRadioLog(m, ps);
    const radio = log.filter((e) => e.kind === 'radio');
    expect(radio.map((e) => [e.radio, e.text])).toEqual([
      ['round-start', 'Lock and load.'],
      ['round-start', 'Go, go, go!'],
      ['player', 'Go, go, go!'],
      ['player', 'Roger that.'],
      ['player', 'Roger that.'],
      ['grenade', 'Fire in the hole!'],
      ['game', 'Counter-Terrorists win.'],
      ['player', 'SOMETHINGNEW'],
    ]);
    // Alpha reconnected (ids 1 and 4): one row.
    expect(radioByPlayer).toEqual([
      { name: 'Alpha', team: 'T', calls: 3, grenades: 0, top: [{ text: 'Roger that.', count: 2 }, { text: 'Go, go, go!', count: 1 }] },
      { name: 'Bravo', team: 'CT', calls: 1, grenades: 1, top: [{ text: 'SOMETHINGNEW', count: 1 }] },
    ]);
  });

  it('collects talk bursts per player, most talk first', () => {
    const v = voiceTimeline(m);
    expect(v.map((r) => [r.name, r.team, r.bursts, r.seconds])).toEqual([
      ['Bravo', 'CT', [[130, 135]], 5],
      ['Alpha', 'T', [[20, 22], [120, 121]], 3],
      ['Player in slot 6', undefined, [[140, 141]], 1],
    ]);
  });
});
