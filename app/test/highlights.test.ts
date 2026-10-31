// 5.o highlights: director picks, multi-kills, knife kills (no demos needed); POV and HLTV of the same half agree (Set 1).
import { describe, expect, it } from 'vitest';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import type { Kill, MatchData } from '../../engine/src/match/types.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { highlights } from '../main/highlights.js';
import { findCandidates } from '../main/library.js';

const player = (id: number, name: string, team: 'T' | 'CT') => ({ id, slot: id - 1, name, names: [name], team, isHltv: false, isRecorder: false, shots: {} });
const kill = (time: number, killer: number, victim: number, weapon = 'ak47'): Kill => ({ time, round: 1, killer, victim, headshot: false, weapon, killerTeam: killer < 4 ? 'T' : 'CT', victimTeam: victim < 4 ? 'T' : 'CT', teamKill: false, suicide: false });
const m: MatchData = {
  map: 'de_test', recording: 'HLTV', restarts: 0, liveStart: 0,
  players: [player(1, 'Ann', 'T'), player(2, 'Bob', 'T'), player(4, 'Cid', 'CT'), player(5, 'Dan', 'CT'), player(6, 'Eve', 'CT')],
  rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'T', reason: 'eliminated' }],
  kills: [kill(20, 1, 4), kill(20.8, 1, 5), kill(40, 2, 6, 'knife')],
  deaths: [], chat: [], radio: [], voice: [], bomb: [],
  director: [
    { time: 16, type: 2, entity1: 1, entity2: 4, flags: 0x19 }, // priority 9
    { time: 18, type: 2, entity1: 1, entity2: 4, flags: 0x09 }, // too close to the last pick
    { time: 30, type: 2, entity1: 2, entity2: 6, flags: 0x03 }, // priority 3: not a highlight
    { time: 31, type: 8 },
  ],
};

describe('5.o highlights', () => {
  it('lists director picks (priority 7+, one per 8 s), quick double kills and knife kills, in time order', () => {
    const h = highlights(m);
    expect(h.map((x) => [x.kind, x.time, x.title])).toEqual([
      ['director', 16, "HLTV director's pick: Ann vs Cid"],
      ['multikill', 20, 'Ann: quick double kill (0.8 s)'],
      ['knife', 40, 'Bob knifed Eve'],
    ]);
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.o on Set 1', () => {
  it('the POV and HLTV demos of the same half find the same multi-kills; the HLTV one also has director picks', () => {
    const cands = findCandidates([zips!]).candidates;
    const read = (name: string) => { const c = cands.find((x) => x.name === name)!; return highlights(extractMatch(readDemo(readZipEntry(c.file, c.zipEntry!)))); };
    const pov = read('modTside'), hltv = read('MoD train T hltvdemo');
    const multi = (h: ReturnType<typeof highlights>) => h.filter((x) => x.kind === 'multikill').map((x) => `${x.round} ${x.title.replace(/ in \d+ s$/, '')}`);
    expect(multi(pov)).toEqual(multi(hltv));
    expect(multi(pov).length).toBeGreaterThanOrEqual(5);
    expect(hltv.filter((x) => x.kind === 'director').length).toBeGreaterThan(30);
    expect(pov.filter((x) => x.kind === 'director')).toHaveLength(0);
  }, 120_000);
});
