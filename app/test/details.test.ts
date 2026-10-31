// Demo details (plan 4.4). With CDF_ZIPS (Set 1 zips) and SPACEDEMO_GAME_DIR (a Half-Life folder with cstrike\maps and
// cstrike\overviews), modTside is checked against the numbers the owner approved on mockup screen 2.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatMessage, readDetails, teamTag } from '../main/details.js';
import { findCandidates } from '../main/library.js';

describe('details helpers', () => {
  it('finds the clan tag most of a team shares', () => {
    expect(teamTag([':i69:Endbringer', ':i69:Guido', ':i69:Urinal', ':i69:Virus23', ':i69:Dr.StrangeLove'])).toBe('i69');
    expect(teamTag(['4u2nv.MoD', 'Tyr.MoD', 'Healthy-Poison.MoD', 'Gobot.MoD', 'Tang.MoD'])).toBe('MoD');
    expect(teamTag(['alpha', 'bravo', 'charlie'])).toBeUndefined();
    expect(teamTag(['solo|x'])).toBeUndefined();
  });

  it('strips the game\'s chat prefix', () => {
    expect(chatMessage('(Terrorist) :i69:Endbringer :   recording', ':i69:Endbringer')).toBe('recording');
    expect(chatMessage('*DEAD* (Counter-Terrorist) Tyr.MoD :  nice', 'Tyr.MoD')).toBe('nice');
    expect(chatMessage('Healthy-Poison.MoD :    lo3?', 'Healthy-Poison.MoD')).toBe('lo3?');
    expect(chatMessage('CAL config file has been executed', undefined)).toBe('CAL config file has been executed');
  });
});

const zips = process.env.CDF_ZIPS;
const game = process.env.SPACEDEMO_GAME_DIR;
describe.skipIf(!zips)('details on a real demo', () => {
  it('modTside matches the approved mockup', () => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === 'modTside')!;
    const mapFile = game ? join(game, 'cstrike', 'maps', 'de_train.bsp') : undefined;
    const d = readDetails({
      key: c.key, file: c.file, zipEntry: c.zipEntry, mapFile: mapFile && existsSync(mapFile) ? mapFile : undefined,
      overviewTxt: game ? join(game, 'cstrike', 'overviews', 'de_train.txt') : undefined, mapIsInstalled: true,
    });
    if ('error' in d) throw new Error(d.error);
    expect(d.score).toEqual({ T: 6, CT: 6, source: 'server', matchesRounds: true });
    expect(d.rounds.map((r) => `${r.winner}${r.reason}`).join(' ')).toBe('CTD CTK CTT CTD TK TK TK TK TB TK CTD CTD');
    expect(d.teams.T.tag).toBe('i69');
    expect(d.teams.CT.tag).toBe('MoD');
    expect(d.teams.T.players[0]).toMatchObject({ name: ':i69:Endbringer', kills: 16, deaths: 6, headshots: 5, recorder: true });
    expect(d.teams.CT.players.map((p) => `${p.name} ${p.kills}`)).toEqual(['4u2nv.MoD 13', 'Tyr.MoD 8', 'Healthy-Poison.MoD 7', 'Gobot.MoD 6', 'Tang.MoD 4']);
    expect(d.teams.CT.heard).toBe(false);
    expect(d.talk.map((t) => [t.name, Math.round(t.seconds / 6) / 10, t.team])).toEqual([
      [':i69:Virus23', 3.2, 'T'], [':i69:Urinal', 2, 'T'], [':i69:Guido', 1.7, 'T'], [':i69:Dr.StrangeLove', 0.8, 'T'],
    ]);
    expect(d.chat[1]).toMatchObject({ who: ':i69:Endbringer', team: 'T', text: 'recording', teamOnly: true });
    if (game) {
      expect(d.map.image?.startsWith('data:image/bmp;base64,')).toBe(true);
      expect(d.map.sites.map((s) => s.letter)).toEqual(['A', 'B']);
      for (const s of d.map.sites) { expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(1024); expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(768); }
    }
  }, 120_000);

  it('gives no picture for an old map version', () => {
    const c = findCandidates([zips!]).candidates.find((x) => x.name === 'mfaTside')!;
    const d = readDetails({ key: c.key, file: c.file, zipEntry: c.zipEntry, mapFile: '/nonexistent.bsp', overviewTxt: '/x.txt', mapIsInstalled: false });
    if ('error' in d) throw new Error(d.error);
    expect(d.map.image).toBeUndefined();
    expect(d.map.note).toMatch(/old version/);
  }, 120_000);
});

describe('overview pictures', () => {
  it('turns the green "no floor" colour of a paletted picture dark, leaving the rest', async () => {
    const { keyOutGreen } = await import('../main/details.js');
    // 1x1 8-bit BMP: 14-byte file header, 40-byte info header, 2 palette entries (green, red), 1 pixel row (4 bytes).
    const b = Buffer.alloc(14 + 40 + 8 + 4);
    b.write('BM', 0, 'latin1'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(62, 10);
    b.writeUInt32LE(40, 14); b.writeInt32LE(1, 18); b.writeInt32LE(1, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(8, 28); b.writeUInt32LE(2, 46);
    b.set([0, 255, 0, 0, 0, 0, 255, 0], 54);
    const out = keyOutGreen(b);
    expect([...out.subarray(54, 62)]).toEqual([18, 16, 14, 0, 0, 0, 255, 0]);
    expect([...b.subarray(54, 58)]).toEqual([0, 255, 0, 0]); // the input is untouched
  });
});
