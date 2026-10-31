// 5.z lag view: spikes against a player's usual ping, the recorder's lost/choked packets within 2 s (made-up data),
// and on Set 1 the POV and HLTV recordings of the same rounds agree on each player's ping (CDF_ZIPS).
import { describe, expect, it } from 'vitest';
import { readDemo } from '../../engine/src/container/read.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import type { MatchData } from '../../engine/src/match/types.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { lagData } from '../main/lag.js';
import { findCandidates } from '../main/library.js';

const pl = (id: number, name: string, team: 'T' | 'CT', extra = {}) => ({ id, slot: id, name, names: [name], team, isHltv: false, isRecorder: false, shots: {}, ...extra });

describe('5.z lag', () => {
  const m: MatchData = {
    map: 'de_test', recording: 'POV', recorderId: 1, restarts: 0, chat: [], radio: [], bomb: [], voice: [], director: [], deaths: [], kills: [],
    players: [pl(1, 'rec', 'T', { isRecorder: true }), pl(2, 'enemy', 'CT'), pl(3, 'HLTV', 'CT', { isHltv: true })],
    rounds: [{ number: 1, start: 0, freezeEnd: 5, end: 100, winner: 'T' }],
    net: {
      pings: [
        ...Array.from({ length: 20 }, (_, i) => ({ time: 10 + i, player: 1, ping: 50, loss: 0 })),
        { time: 40, player: 1, ping: 160, loss: 2 }, { time: 45, player: 1, ping: 140, loss: 0 },
        ...Array.from({ length: 20 }, (_, i) => ({ time: 10 + i, player: 2, ping: 120, loss: 0 })),
        { time: 50, player: 2, ping: 230, loss: 0 }, { time: 51, player: 3, ping: 900, loss: 0 },
      ],
      choke: [60, 60.5, 61, 61.2, 61.9, 80],
      lost: [{ time: 70, packets: 3 }, { time: 71, packets: 2 }, { time: 90, packets: 4 }],
    },
  };
  it('finds spikes per player, and 5+ lost or choked packets within 2 s for the recorder', () => {
    const l = lagData(m, 100);
    expect(l.players.map((p) => `${p.name} ${p.median}/${p.max} ${p.spikes}`)).toEqual(['enemy 120/230 0', 'rec 50/160 1']);
    expect(l.moments.map((x) => `${x.time} ${x.kind} ${x.who} ${x.worst}`)).toEqual(['40 ping rec 160', '60 choke rec 5', '70 lost rec 5']);
    expect(l.recorder?.lostTotal).toBe(9);
    expect(l.moments.every((x) => x.round === 1)).toBe(true);
  });
});

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('5.z on Set 1', () => {
  it('modTside and its HLTV demo agree on every player\'s usual ping; the round 3 spikes show in both', () => {
    const seen = new Set<string>();
    const demos = findCandidates([zips!]).candidates.filter((c) => !seen.has(c.name) && seen.add(c.name));
    const lag = (name: string) => { const c = demos.find((x) => x.name === name)!; return lagData(extractMatch(readDemo(readZipEntry(c.file, c.zipEntry!))), 2000); };
    const pov = lag('modTside'), hltv = lag('MoD train T hltvdemo');
    expect(pov.players).toHaveLength(10);
    for (const p of pov.players) expect(Math.abs(p.median - hltv.players.find((h) => h.name === p.name)!.median), p.name).toBeLessThanOrEqual(3);
    for (const l of [pov, hltv]) expect(l.moments.filter((x) => x.kind === 'ping' && x.round === 3).map((x) => x.who).filter((w, i, a) => a.indexOf(w) === i).sort()).toEqual([':i69:Dr.StrangeLove', ':i69:Guido']);
    expect(pov.recorder?.choke.length).toBeGreaterThan(50);
    expect(hltv.recorder).toBeUndefined();
  }, 120_000);
});
