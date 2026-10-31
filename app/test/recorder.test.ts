// 5.n recorder panel: money per round, spending, keys paired, speed (no demos needed), and Set 1 (CDF_ZIPS).
import { describe, expect, it } from 'vitest';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import type { MatchData, TrackPoint } from '../../engine/src/match/types.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { findCandidates } from '../main/library.js';
import { recorderPanel } from '../main/recorder.js';

const pt = (time: number, x: number): TrackPoint => ({ time, x, y: 0, z: 0, alive: true });
const m: MatchData = {
  map: 'de_test', recording: 'POV', restarts: 0, recorderId: 1,
  players: [{ id: 1, slot: 0, name: 'Me', names: ['Me'], team: 'T', isHltv: false, isRecorder: true, shots: {} }],
  rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'T', reason: 'eliminated' }, { number: 2, start: 105, freezeEnd: 110, end: 200 }],
  kills: [], deaths: [], chat: [], radio: [], voice: [], bomb: [], director: [],
  recorder: {
    money: [{ time: 0.2, money: 800 }, { time: 6, money: 150 }, { time: 7, money: 0 }, { time: 7, money: 50 }, { time: 101, money: 3300 }, { time: 106, money: 3300 }, { time: 108, money: 800 }],
    health: [{ time: 0.2, health: 100 }, { time: 40, health: 73 }],
    damageTaken: [{ time: 40, amount: 27, from: [0, 0, 0] }],
    menus: [], shots: 0, weapons: [{ time: 1, weapon: 'knife' }, { time: 6.5, weapon: 'deagle' }, { time: 109, weapon: 'ak47' }],
    keys: [{ time: 10, command: '+forward' }, { time: 11, command: '+jump' }, { time: 11.2, command: '-jump' }, { time: 12, command: '-forward' }, { time: 13, command: '+showscores' }, { time: 13.5, command: '-showscores' }, { time: 14, command: '+voicerecord' }],
  },
  tracks: [{ player: 1, seen: Array.from({ length: 40 }, (_, i) => pt(10 + i * 0.1, i * 25)), radar: [], heard: [] }],
};

describe('5.n recorder panel', () => {
  const p = recorderPanel(m)!;
  it('works out money and spending per round', () => {
    expect(p.money).toEqual([[0.2, 800], [6, 150], [7, 50], [101, 3300], [106, 3300], [108, 800]]);
    expect(p.rounds.map((r) => [r.startMoney, r.spent, r.endMoney])).toEqual([[800, 750, 3300], [3300, 2500, 800]]);
    expect(p.rounds[0].weapons).toEqual(['knife', 'deagle']);
    expect(p.rounds[1].weapons).toEqual(['ak47']);
    expect(p.rounds[0].damage).toEqual([{ time: 40, amount: 27 }]);
  });
  it('pairs key presses and leaves out unknown commands', () => {
    expect(p.keys).toEqual([['jump', 11, 11.2], ['forward', 10, 12], ['showscores', 13, 13.5]]);
  });
  it('measures running speed (25 units per 0.1 s = 250/s)', () => {
    expect(p.rounds[0].topSpeed).toBe(250);
    expect(p.rounds[0].avgSpeed).toBe(250);
  });
  it('is only for player demos', () => {
    expect(recorderPanel({ ...m, recording: 'HLTV' })).toBeUndefined();
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.n on Set 1', () => {
  it('modTside: pistol round $800, the bomb in round 1, an AK bought in round 3', () => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === 'modTside')!;
    const p = recorderPanel(extractMatch(readDemo(readZipEntry(c.file, c.zipEntry!)), { tracks: true }))!;
    expect(p.name).toBe(':i69:Endbringer');
    expect(p.rounds[0]).toMatchObject({ startMoney: 800, kills: 1 });
    expect(p.rounds[0].weapons).toContain('c4');
    expect(p.rounds[2].weapons).toContain('ak47');
    expect(p.rounds[2].spent).toBeGreaterThanOrEqual(2500);
    expect(p.keys.length).toBeGreaterThan(1000);
  }, 120_000);
});
