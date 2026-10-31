// 5.y round story: sentences from made-up round details, and on Set 1 modTside (CDF_ZIPS + SPACEDEMO_GAME_DIR).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DemoDetails, RoundDetail } from '../shared/api.js';
import { nearSite, roundStory } from '../renderer/story.js';
import { readDetails } from '../main/details.js';
import { findCandidates } from '../main/library.js';

const kill = (at: number, killer: string, victim: string, killerTeam: 'T' | 'CT', headshot = false) => ({ at, killer, victim, killerTeam, victimTeam: killerTeam === 'T' ? 'CT' as const : 'T' as const, weapon: 'ak47', headshot, teamKill: false });

describe('5.y round story', () => {
  it('names a site only when clearly nearer to it', () => {
    const sites = [{ letter: 'A', x: 0, y: 0 }, { letter: 'B', x: 100, y: 0 }];
    expect(nearSite(sites, 10, 0)).toBe('A');
    expect(nearSite(sites, 50, 0)).toBeUndefined();
    expect(nearSite([{ letter: 'A', x: 0, y: 0 }], 1, 1)).toBeUndefined();
  });
  it('tells the opening kill, the plant, a retake from behind and a multi-kill', () => {
    const r: RoundDetail = {
      number: 4, winner: 'CT', reason: 'bomb defused', scoreT: 2, scoreCT: 2, seconds: 110,
      kills: [kill(30, 'tom', 'carl', 'T', true), kill(40, 'tim', 'cid', 'T'), kill(70, 'cal', 'tom', 'CT'), kill(75, 'cal', 'tim', 'CT'), kill(80, 'cal', 'tad', 'CT')],
      plantedAt: 50, bombEnd: { kind: 'defused', at: 85 }, bombTimer: 35,
      alive: { T: 3, CT: 3, steps: [{ at: 30, T: 3, CT: 2, who: 'carl' }, { at: 40, T: 3, CT: 1, who: 'cid' }, { at: 70, T: 2, CT: 1, who: 'tom' }, { at: 75, T: 1, CT: 1, who: 'tim' }, { at: 80, T: 0, CT: 1, who: 'tad' }] },
    };
    const d = {
      roundDetails: [r], stats: [{ name: 'cal', clutches: [{ round: 4, vs: 3 }] }], momentum: { openings: 1, openingWins: 0, comebacks: [{ round: 4, side: 'CT', down: 2 }] },
      heatmap: { sites: [{ letter: 'A', x: 0, y: 0 }, { letter: 'B', x: 100, y: 0 }], kills: [{ round: 4, time: 130, killer: 'tom', victim: 'carl', vx: 95, vy: 5, teamKill: false, suicide: false }], plants: [{ round: 4, time: 150, x: 98, y: 0, site: 'B' }] },
    } as unknown as DemoDetails;
    expect(roundStory(d, r, { T: 'Reds', CT: 'Blues' })).toBe(
      'Reds opened: tom killed carl at 0:30 near B (headshot). Reds planted at B at 0:50, 3 v 1 alive. Blues retook from 1 v 3 down and defused at 1:25, 35 s after the plant. cal won it alone, 1 v 3. cal got 3 kills.');
  });
});

const zips = process.env.CDF_ZIPS;
const game = process.env.SPACEDEMO_GAME_DIR;
describe.skipIf(!zips || !game)('5.y on Set 1', () => {
  it('modTside: every round has a story; round 1 is the pistol round planted at B, round 9 the bomb exploded', () => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === 'modTside')!;
    const mapFile = join(game!, 'cstrike', 'maps', 'de_train.bsp');
    const d = readDetails({ key: c.key, file: c.file, zipEntry: c.zipEntry, mapFile: existsSync(mapFile) ? mapFile : undefined, overviewTxt: join(game!, 'cstrike', 'overviews', 'de_train.txt'), mapIsInstalled: true });
    if ('error' in d) throw new Error(d.error);
    const tags = { T: d.teams.T.tag!, CT: d.teams.CT.tag! };
    const stories = d.roundDetails.map((r) => roundStory(d, r, tags));
    expect(stories).toHaveLength(12);
    expect(stories.every((s) => s.length > 20)).toBe(true);
    expect(stories[0]).toBe('Pistol round. MoD opened: 4u2nv.MoD killed :i69:Dr.StrangeLove at 0:58 near B. i69 planted at B at 1:07, 3 v 4 alive. MoD retook and defused at 1:31, 24 s after the plant.');
    expect(stories[8]).toContain('The bomb exploded');
    expect(stories[2]).toContain('time ran out');
  }, 120_000);
});
