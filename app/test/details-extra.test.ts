// Phase 5 extras (5.c rounds, 5.d stats, 5.h overview) on the real Set 1 demos (CDF_ZIPS).
// 5.d check from the plan: the kills counted here equal the game's own scoreboard (server frags = kills − team kills
// − suicides) for every player in every demo.
import { describe, expect, it } from 'vitest';
import { readDemo } from '../../engine/src/container/read.js';
import { inspectParsed } from '../../engine/src/inspect.js';
import { extractMatch } from '../../engine/src/match/extract.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { chatRadioLog, overviewInfo, periods, playersByName, roundDetails, statRows, voiceTimeline } from '../main/details-extra.js';
import { findCandidates } from '../main/library.js';

const zips = process.env.CDF_ZIPS;
describe.skipIf(!zips)('details extras on Set 1', () => {
  const demos = () => {
    const seen = new Set<string>();
    return findCandidates([zips!]).candidates.filter((c) => !seen.has(c.name) && seen.add(c.name));
  };

  it('kills agree with the server\'s own frags for every player (5.d)', () => {
    let checked = 0;
    const off: string[] = [];
    for (const c of demos()) {
      const m = extractMatch(readDemo(c.zipEntry ? readZipEntry(c.file, c.zipEntry) : new Uint8Array()));
      const stats = statRows(m);
      for (const [name, e] of playersByName(m)) {
        const conns = m.players.filter((p) => e.ids.includes(p.id));
        // Only one connection, final frags sent, and present when the match went live (warm-up scores aren't reset).
        if (conns.length !== 1 || conns[0].frags === undefined) continue;
        if (conns[0].leftAt !== undefined && m.liveStart !== undefined && conns[0].leftAt < m.liveStart) continue;
        const s = stats.find((x) => x.name === name);
        if (!s) continue;
        checked++;
        if (s.kills - s.teamKills - s.suicides !== conns[0].frags) off.push(`${c.name} ${name}: ${s.kills}-${s.teamKills}-${s.suicides} vs ${conns[0].frags}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(off).toEqual([]);
  }, 600_000);

  it('modTside: rounds, bomb timer, stats and overview', () => {
    const c = demos().find((x) => x.name === 'modTside')!;
    const bytes = readZipEntry(c.file, c.zipEntry!);
    const demo = readDemo(bytes);
    const m = extractMatch(demo);
    const rounds = roundDetails(m);
    expect(rounds).toHaveLength(12);
    expect(rounds[0]).toMatchObject({ winner: 'CT', reason: 'bomb defused', scoreT: 0, scoreCT: 1 });
    expect(rounds[0].kills).toHaveLength(6);
    expect(Math.round(rounds[0].bombTimer!)).toBe(24);
    const stats = statRows(m);
    expect(stats.find((s) => s.name === ':i69:Endbringer')).toMatchObject({ team: 'T', kills: 16, deaths: 6, headshots: 5, firstKills: 5, recorder: true });
    expect(stats.find((s) => s.name === 'Tang.MoD')?.teamKills).toBe(2);
    const o = overviewInfo(inspectParsed(demo, bytes.length), m);
    expect(o).toMatchObject({ hostName: 'Delusional Tx CS Priv', serverBuild: 2056, maxClients: 22, voiceCodec: 'voice_miles' });
    expect(o.serverMessages[0]).toBe('<CAL CS Match Server> CAL config file has been executed');
    expect(o.network.find((n) => n.name === ':i69:Urinal')).toMatchObject({ rate: '21000', updateRate: '30', clientWeapons: '1', lagCompensation: '1' });
  }, 120_000);

  it('forsakenctside: sides come from the kills, not the last team seen', () => {
    const c = demos().find((x) => x.name === 'forsakenctside')!;
    const m = extractMatch(readDemo(readZipEntry(c.file, c.zipEntry!)));
    const sides = playersByName(m);
    expect(sides.get(':i69:Dr.StrangeLove')?.team).toBe('CT');
    expect(statRows(m).filter((s) => s.team === 'CT')).toHaveLength(5);
  }, 120_000);

  it('modTside and an HLTV demo: chat and radio log (5.l), voice timeline (5.m)', () => {
    const read = (name: string) => {
      const c = demos().find((x) => x.name === name)!;
      const bytes = readZipEntry(c.file, c.zipEntry!);
      const demo = readDemo(bytes);
      return { m: extractMatch(demo), r: inspectParsed(demo, bytes.length) };
    };
    const { m, r } = read('modTside');
    const ps = periods(m, r.seconds);
    expect(ps.map((p) => p.id)).toEqual(['warmup', ...Array.from({ length: 12 }, (_, n) => `r${n + 1}`), 'after']);
    const { log, radioByPlayer } = chatRadioLog(m, ps, r.hostName);
    expect(log.filter((e) => e.kind === 'chat')).toHaveLength(36);
    expect(log.filter((e) => e.kind === 'radio')).toHaveLength(107);
    expect(log.filter((e) => e.channel === 'team')).toHaveLength(4);
    expect(log.find((e) => e.channel === 'server')?.text).toBe('CAL config file has been executed');
    expect(log.filter((e) => e.radio === 'round-start')).toHaveLength(15);
    expect(radioByPlayer[0]).toMatchObject({ name: ':i69:Guido', calls: 7, grenades: 14 });
    const v = voiceTimeline(m);
    expect(v.map((x) => x.name)).toEqual([':i69:Virus23', ':i69:Urinal', ':i69:Guido', ':i69:Dr.StrangeLove']);
    expect(v.reduce((a, x) => a + x.bursts.length, 0)).toBe(m.voice.length);
    // The recorder's own voice isn't in his demo; everyone heard is on his team.
    expect(v.every((x) => x.team === 'T')).toBe(true);

    const h = read('MoD train CT hltvdemo');
    const hl = chatRadioLog(h.m, periods(h.m, h.r.seconds), h.r.hostName).log;
    expect(hl.filter((e) => e.channel === 'hltv').length).toBeGreaterThan(400);
    expect(hl.filter((e) => e.channel === 'dead').length).toBe(13);
  }, 120_000);
});
