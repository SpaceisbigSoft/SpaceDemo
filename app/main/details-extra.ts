// Phase 5 extras on the details page (plan 5.h match overview, 5.c rounds and timeline, 5.d scoreboard and stats).
// Everything is counted from the engine's match data (2.12) and the inspector (1.1b); nothing is guessed. A player who
// reconnected has two server user ids: his numbers are added up by name.
import type { InspectReport } from '../../engine/src/inspect.js';
import type { MatchData, Team } from '../../engine/src/match/types.js';
import type { NetworkRow, OverviewInfo, RoundDetail, StatRow } from '../shared/api.js';

const side = (t: Team | undefined): 'T' | 'CT' | undefined => (t === 'T' || t === 'CT' ? t : undefined);

/**
 * Player ids per name, and the side each name played. The side comes from the kill events (each kill carries both
 * players' sides at that moment): the side seen most often. A player's "last team" alone isn't enough, because some
 * recordings run on past half-time, after the teams switched. Players in no kill keep their last team.
 */
export function playersByName(m: MatchData): Map<string, { ids: number[]; team?: 'T' | 'CT'; recorder: boolean }> {
  const out = new Map<string, { ids: number[]; team?: 'T' | 'CT'; recorder: boolean }>();
  for (const p of m.players) {
    if (p.isHltv || !p.name) continue;
    const e = out.get(p.name) ?? { ids: [], team: undefined, recorder: false };
    e.ids.push(p.id);
    e.team ??= side(p.team);
    e.recorder ||= p.isRecorder;
    out.set(p.name, e);
  }
  const votes = new Map<string, { T: number; CT: number }>();
  const nameOf = (id: number | null) => (id === null ? undefined : m.players.find((p) => p.id === id)?.name);
  const vote = (name: string | undefined, t: 'T' | 'CT' | undefined) => {
    if (!name || !t) return;
    const v = votes.get(name) ?? { T: 0, CT: 0 };
    v[t]++;
    votes.set(name, v);
  };
  for (const k of m.kills) {
    if (!k.suicide) vote(nameOf(k.killer), side(k.killerTeam));
    vote(nameOf(k.victim), side(k.victimTeam));
  }
  for (const [name, v] of votes) {
    const e = out.get(name);
    if (e && v.T !== v.CT) e.team = v.T > v.CT ? 'T' : 'CT';
  }
  return out;
}

/** 5.h: server, settings and each player's network settings. */
export function overviewInfo(r: InspectReport, m: MatchData): OverviewInfo {
  const network: NetworkRow[] = r.players
    .filter((p) => p.name && !p.isHltv)
    .map((p) => ({
      name: p.name,
      team: side(p.team === 'TERRORIST' ? 'T' : p.team === 'CT' ? 'CT' : undefined),
      rate: p.rate,
      updateRate: p.updateRate,
      clientWeapons: p.clientWeapons,
      lagCompensation: p.lagCompensation,
      changes: p.settingChanges.map((c) => `${c.setting} ${c.value} at ${Math.floor(c.time / 60)}:${String(Math.floor(c.time % 60)).padStart(2, '0')}`),
      recorder: p.isRecorder,
    }));
  // Server messages (no sender), e.g. "CAL config file has been executed": shows the league config used.
  // Only the server's own lines: no "<name>" in front, or a name that is the server (e.g. "<CAL CS Match Server>").
  const fromServer = (t: string) => { const n = /^<([^>]*)>/.exec(t)?.[1]; return n === undefined || /server/i.test(n) || n === r.hostName?.trim(); };
  const serverMessages = [...new Set(m.chat.filter((c) => c.sender === undefined).map((c) => c.text.trim().replace(/"$/, '')).filter((t) => t && fromServer(t)))].slice(0, 12);
  return {
    hostName: r.hostName?.trim() || undefined,
    serverBuild: r.serverBuild,
    maxClients: r.maxClients,
    voiceCodec: r.voiceCodec,
    voiceQuality: r.voiceQuality,
    measuredUpdatesPerSecond: r.measuredUpdatesPerSecond,
    measuredFps: r.measuredFps,
    restarts: m.restarts,
    liveStart: m.liveStart,
    serverMessages,
    network,
  };
}

/** 5.c: per round — length, kills on a timeline, bomb plant/defuse/explosion and the bomb timer. */
export function roundDetails(m: MatchData): RoundDetail[] {
  const nameOf = (id: number | null) => (id === null ? 'the world' : m.players.find((p) => p.id === id)?.name ?? '?');
  return m.rounds.map((r) => {
    const t0 = r.freezeEnd ?? r.start;
    const end = r.end ?? t0;
    const kills = m.kills.filter((k) => k.round === r.number).map((k) => ({
      at: k.time - t0,
      killer: nameOf(k.killer),
      victim: nameOf(k.victim),
      killerTeam: side(k.killerTeam),
      victimTeam: side(k.victimTeam),
      weapon: k.weapon,
      headshot: k.headshot,
      teamKill: k.teamKill,
    }));
    const bomb = m.bomb.filter((b) => b.round === r.number && (b.kind === 'planted' || b.kind === 'defused' || b.kind === 'exploded'));
    const planted = bomb.find((b) => b.kind === 'planted');
    const after = bomb.find((b) => b.kind === 'defused' || b.kind === 'exploded');
    return {
      number: r.number,
      winner: r.winner,
      reason: r.reason,
      scoreT: r.scoreT,
      scoreCT: r.scoreCT,
      seconds: Math.max(0, end - t0),
      kills,
      plantedAt: planted ? planted.time - t0 : undefined,
      bombEnd: after ? { kind: after.kind as 'defused' | 'exploded', at: after.time - t0 } : undefined,
      bombTimer: planted && after ? after.time - planted.time : undefined,
    };
  });
}

/** 5.d: scoreboard and stats per player. Accuracy and damage aren't in these demos, so they aren't shown. */
export function statRows(m: MatchData): StatRow[] {
  const byName = playersByName(m);
  const nameOfId = new Map<number, string>();
  for (const [name, e] of byName) for (const id of e.ids) nameOfId.set(id, name);
  const rows = new Map<string, StatRow>();
  for (const [name, e] of byName) {
    if (!e.team) continue;
    const shots: Record<string, number> = {};
    for (const p of m.players.filter((x) => e.ids.includes(x.id))) for (const [w, n] of Object.entries(p.shots)) shots[w] = (shots[w] ?? 0) + n;
    rows.set(name, {
      name, team: e.team, recorder: e.recorder, kills: 0, deaths: 0, headshots: 0, teamKills: 0, suicides: 0,
      weapons: {}, multiKills: { 2: 0, 3: 0, 4: 0, 5: 0 }, firstKills: 0, firstDeaths: 0, clutches: [], shots,
    });
  }
  const row = (id: number | null) => (id === null ? undefined : rows.get(nameOfId.get(id) ?? ''));

  for (const k of m.kills) {
    const killer = row(k.killer);
    const victim = row(k.victim);
    if (victim) victim.deaths++;
    if (!killer) continue;
    if (k.suicide) killer.suicides++;
    else if (k.teamKill) killer.teamKills++;
    else {
      killer.kills++;
      if (k.headshot) killer.headshots++;
      killer.weapons[k.weapon] = (killer.weapons[k.weapon] ?? 0) + 1;
    }
  }

  for (const r of m.rounds) {
    const ks = m.kills.filter((k) => k.round === r.number).sort((a, b) => a.time - b.time);
    // Multi-kills: enemy kills by one player in this round.
    const perPlayer = new Map<StatRow, number>();
    for (const k of ks) {
      const kr = row(k.killer);
      if (kr && !k.teamKill && !k.suicide) perPlayer.set(kr, (perPlayer.get(kr) ?? 0) + 1);
    }
    for (const [p, n] of perPlayer) if (n >= 2) p.multiKills[Math.min(n, 5) as 2 | 3 | 4 | 5]++;
    // First kill / first death of the round (enemy kills only).
    const first = ks.find((k) => !k.teamKill && !k.suicide && k.killer !== null);
    if (first) { const a = row(first.killer); const b = row(first.victim); if (a) a.firstKills++; if (b) b.firstDeaths++; }
    // Clutch: a player left alone against X enemies whose team then wins the round.
    // Sides in this round: from this round's kills when the player is in one, else his usual side.
    const sideNow = new Map<StatRow, 'T' | 'CT'>();
    for (const k of ks) {
      const a = row(k.killer), b = row(k.victim);
      if (a && side(k.killerTeam) && !k.suicide) sideNow.set(a, side(k.killerTeam)!);
      if (b && side(k.victimTeam)) sideNow.set(b, side(k.victimTeam)!);
    }
    const alive = { T: new Set<StatRow>(), CT: new Set<StatRow>() };
    for (const p of rows.values()) alive[sideNow.get(p) ?? p.team].add(p);
    const teamOf = (p: StatRow) => sideNow.get(p) ?? p.team;
    // Each side's first moment with one player left (while enemies are still alive).
    const clutch: { T?: { player: StatRow; vs: number }; CT?: { player: StatRow; vs: number } } = {};
    for (const k of ks) {
      const v = row(k.victim);
      if (v) alive[teamOf(v)].delete(v);
      for (const t of ['T', 'CT'] as const) {
        const other = t === 'T' ? 'CT' : 'T';
        if (!clutch[t] && alive[t].size === 1 && alive[other].size >= 1) clutch[t] = { player: [...alive[t]][0], vs: alive[other].size };
      }
    }
    // Won: his side won the round and he was still alive (or, for a T, the bomb exploded after he planted it and died).
    const w = r.winner === 'T' || r.winner === 'CT' ? clutch[r.winner] : undefined;
    if (w && (alive[teamOf(w.player)].has(w.player) || r.reason === 'bomb exploded')) w.player.clutches.push({ round: r.number, vs: w.vs });
  }
  return [...rows.values()].sort((a, b) => (a.team === b.team ? b.kills - a.kills || a.deaths - b.deaths : a.team === 'T' ? -1 : 1));
}
