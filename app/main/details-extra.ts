// Phase 5 extras on the details page (plan 5.h match overview, 5.c rounds and timeline, 5.d scoreboard and stats,
// 5.l chat and radio log, 5.m voice timeline).
// Everything is counted from the engine's match data (2.12) and the inspector (1.1b); nothing is guessed. A player who
// reconnected has two server user ids: his numbers are added up by name.
import type { InspectReport } from '../../engine/src/inspect.js';
import type { MatchData, Team } from '../../engine/src/match/types.js';
import type { ChatChannel, LogEntry, NetworkRow, OverviewInfo, Period, RadioKind, RadioSummary, RoundDetail, StatRow, VoiceRow, Momentum } from '../shared/api.js';

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

/**
 * 5.t: who is in a round, per side. A player (by name; reconnects add up) is in it when not all his connections had
 * left before it started and the demo knows him by then (a position, kill or death up to the round's end). His side is
 * the one his kills/deaths in this round say, else his usual side.
 */
function aliveIn(m: MatchData, r: MatchData['rounds'][number], sides: ReturnType<typeof playersByName>) {
  const t0 = r.freezeEnd ?? r.start, end = r.end ?? t0;
  const firstSeen = new Map<number, number>();
  const seen = (id: number, t: number) => { if (t < (firstSeen.get(id) ?? Infinity)) firstSeen.set(id, t); };
  for (const t of m.tracks ?? []) for (const pts of [t.seen, t.radar, t.heard]) if (pts.length) seen(t.player, pts[0].time);
  for (const k of m.kills) { if (k.killer !== null) seen(k.killer, k.time); seen(k.victim, k.time); }
  for (const c of m.chat) if (c.sender !== undefined) seen(c.sender, c.time);
  const ks = m.kills.filter((k) => k.round === r.number);
  const roster: { name: string; side: 'T' | 'CT'; ids: number[]; leftAt?: number }[] = [];
  for (const [name, e] of sides) {
    if (!e.team) continue;
    const conns = m.players.filter((p) => e.ids.includes(p.id));
    if (conns.every((p) => p.leftAt !== undefined && p.leftAt < r.start)) continue;
    if (!conns.some((p) => (firstSeen.get(p.id) ?? Infinity) <= end)) continue;
    let s = e.team;
    for (const k of ks) {
      if (e.ids.includes(k.victim) && side(k.victimTeam)) s = side(k.victimTeam)!;
      else if (k.killer !== null && e.ids.includes(k.killer) && !k.suicide && side(k.killerTeam)) s = side(k.killerTeam)!;
    }
    // Left during the round (a reconnect doesn't bring him back into it).
    const leftAt = conns.map((p) => p.leftAt).filter((x): x is number => x !== undefined && x >= r.start && x <= end).sort((a, b) => a - b)[0];
    roster.push({ name, side: s, ids: e.ids, leftAt });
  }
  const count = { T: roster.filter((p) => p.side === 'T').length, CT: roster.filter((p) => p.side === 'CT').length };
  const start = { ...count };
  const dead = new Set<string>();
  const events: { time: number; name: string; left: boolean }[] = [];
  for (const k of ks) { const p = roster.find((x) => x.ids.includes(k.victim)); if (p) events.push({ time: k.time, name: p.name, left: false }); }
  for (const p of roster) if (p.leftAt !== undefined) events.push({ time: p.leftAt, name: p.name, left: true });
  events.sort((a, b) => a.time - b.time);
  const steps: RoundDetail['alive']['steps'] = [];
  for (const e of events) {
    if (dead.has(e.name)) continue;
    dead.add(e.name);
    const p = roster.find((x) => x.name === e.name)!;
    count[p.side] = Math.max(0, count[p.side] - 1);
    steps.push({ at: Math.round((e.time - t0) * 10) / 10, T: count.T, CT: count.CT, who: e.name, ...(e.left ? { left: true } : {}) });
  }
  return { ...start, steps };
}

/** 5.t: opening kills, comebacks and man-advantage rounds from the players-alive counts. */
export function momentum(rounds: RoundDetail[]): Momentum {
  const out: Momentum = { openings: 0, openingWins: 0, comebacks: [] };
  for (const r of rounds) {
    if (r.winner !== 'T' && r.winner !== 'CT') continue;
    const first = r.alive.steps.find((s) => !s.left);
    if (first) {
      out.openings++;
      // The side with more players after the first death got the opening kill.
      const up = first.T > first.CT ? 'T' : first.CT > first.T ? 'CT' : undefined;
      if (up === r.winner) out.openingWins++;
    }
    const other = r.winner === 'T' ? 'CT' : 'T';
    let worst = 0;
    for (const s of r.alive.steps) worst = Math.max(worst, s[other] - s[r.winner]);
    if (worst >= 2) out.comebacks.push({ round: r.number, side: r.winner, down: worst });
  }
  return out;
}

/** 5.c: per round — length, kills on a timeline, bomb plant/defuse/explosion and the bomb timer; 5.t players alive. */
export function roundDetails(m: MatchData): RoundDetail[] {
  const nameOf = (id: number | null) => (id === null ? 'the world' : m.players.find((p) => p.id === id)?.name ?? '?');
  const sides = playersByName(m);
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
      alive: aliveIn(m, r, sides),
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

// ---------- 5.l chat and radio log, 5.m voice timeline ----------

/** Radio calls as the game says them (radio sound names in CS 1.5/1.6). Unknown names are shown as they are. */
export const RADIO_TEXT: Record<string, string> = {
  COVERME: 'Cover me!', TAKEPOINT: 'You take the point.', POSITION: 'Hold this position.', REGROUP: 'Regroup, team.',
  FOLLOWME: 'Follow me.', HITASSIST: 'Taking fire, need assistance!', GO: 'Go, go, go!', FALLBACK: 'Team, fall back!',
  STICKTOG: 'Stick together, team.', GETINPOS: 'Get in position and wait for my go.', STORMFRONT: 'Storm the front!',
  REPORTIN: 'Report in, team.', AFFIRM: 'Affirmative.', ROGER: 'Roger that.', ENEMYSPOT: 'Enemy spotted.',
  BACKUP: 'Need backup.', CLEAR: 'Sector clear.', INPOS: "I'm in position.", REPRTINGIN: 'Reporting in.',
  BLOW: "Get out of there, it's gonna blow!", NEGATIVE: 'Negative.', ENEMYDOWN: 'Enemy down.',
  MOVEOUT: "OK, let's move out.", LETSGO: "Let's go!", LOCKNLOAD: 'Lock and load.', FIREINHOLE: 'Fire in the hole!',
  BOMBPL: 'The bomb has been planted.', BOMBDEF: 'The bomb has been defused.',
  ctwin: 'Counter-Terrorists win.', terwin: 'Terrorists win.', rounddraw: 'Round draw.',
  rescued: 'Hostages have been rescued.', escaped: 'The VIP has escaped.', vipdown: 'The VIP has been assassinated.',
};
/** Calls the game plays by itself at the end of freeze time (for a random teammate). None of them is in the radio menus,
 *  except "Go, go, go!", which counts as round start only right at the end of freeze time. */
const ROUND_START = new Set(['LETSGO', 'LOCKNLOAD', 'MOVEOUT']);

/** Warm-up (before round 1), each round (to the next round's start), and after the last round (5 s after its end). */
export function periods(m: MatchData, demoSeconds: number): Period[] {
  const out: Period[] = [];
  const rs = m.rounds;
  const end = Math.max(demoSeconds, ...m.voice.map((v) => v.end), ...m.chat.map((c) => c.time));
  if (rs.length === 0) return [{ id: 'all', label: 'Whole demo', start: 0, end }];
  if (rs[0].start > 0) out.push({ id: 'warmup', label: 'Warm-up', start: 0, end: rs[0].start });
  rs.forEach((r, n) => {
    const next = rs[n + 1]?.start ?? Math.min(end, (r.end ?? r.start) + 5);
    out.push({ id: `r${r.number}`, label: `Round ${r.number}`, round: r.number, start: r.start, end: next, freezeEnd: r.freezeEnd, roundEnd: r.end, winner: r.winner });
  });
  const last = out[out.length - 1].end;
  if (end > last + 0.5) out.push({ id: 'after', label: 'After the match', start: last, end });
  return out;
}

const periodAt = (ps: Period[], t: number) => (ps.find((p) => t >= p.start && t < p.end) ?? (t < ps[0].start ? ps[0] : ps[ps.length - 1])).id;

/** 5.l: chat and radio in time order, each with its channel; plus radio calls per player. */
export function chatRadioLog(m: MatchData, ps: Period[], hostName?: string): { log: LogEntry[]; radioByPlayer: RadioSummary[] } {
  const sides = playersByName(m);
  const byId = new Map(m.players.map((p) => [p.id, p]));
  const teamOf = (id?: number) => {
    const p = id === undefined ? undefined : byId.get(id);
    return p ? sides.get(p.name)?.team ?? side(p.team) : undefined;
  };
  const log: LogEntry[] = [];
  for (const c of m.chat) {
    const p = c.sender === undefined ? undefined : byId.get(c.sender);
    let channel: ChatChannel;
    let who = p?.name;
    let text: string;
    if (!p) {
      // No sender: the server's own lines, or (HLTV demos) chat from people watching through HLTV: "<name> text".
      const mm = /^<([^>]*)>\s*(.*)$/s.exec(c.text);
      const name = mm?.[1];
      const isServer = name === undefined || /server/i.test(name) || name === hostName?.trim();
      channel = isServer ? 'server' : 'hltv';
      who = isServer ? undefined : name;
      text = (mm ? mm[2] : c.text).trim().replace(/"$/, '');
    } else {
      const deadTeam = /^\*DEAD\*\s*\(/.test(c.text);
      const spectator = /^(\*SPEC\*|\(Spectator\))/i.test(c.text) || p.team === 'SPECTATOR';
      channel = spectator ? 'spectator' : c.dead ? (c.teamOnly || deadTeam ? 'dead-team' : 'dead') : c.teamOnly ? 'team' : 'all';
      text = chatText(c.text, p.name);
    }
    if (!text) continue;
    log.push({ time: c.time, period: periodAt(ps, c.time), kind: 'chat', channel, who, team: p ? teamOf(p.id) : undefined, text });
  }
  const summary = new Map<string, { team?: 'T' | 'CT'; calls: number; grenades: number; counts: Map<string, number> }>();
  for (const r of m.radio) {
    const p = r.sender === undefined ? undefined : byId.get(r.sender);
    const text = RADIO_TEXT[r.message] ?? r.message;
    const round = ps.find((x) => x.round !== undefined && r.time >= x.start && r.time < x.end);
    let radio: RadioKind = 'player';
    if (!p) radio = 'game';
    else if (r.message === 'FIREINHOLE') radio = 'grenade';
    else if (ROUND_START.has(r.message) || (r.message === 'GO' && round?.freezeEnd !== undefined && Math.abs(r.time - round.freezeEnd) < 1.5)) radio = 'round-start';
    log.push({ time: r.time, period: periodAt(ps, r.time), kind: 'radio', radio, who: p?.name, team: p ? teamOf(p.id) : undefined, text });
    if (p && (radio === 'player' || radio === 'grenade')) {
      const s = summary.get(p.name) ?? { team: teamOf(p.id), calls: 0, grenades: 0, counts: new Map() };
      if (radio === 'grenade') s.grenades++;
      else { s.calls++; s.counts.set(text, (s.counts.get(text) ?? 0) + 1); }
      summary.set(p.name, s);
    }
  }
  log.sort((a, b) => a.time - b.time);
  const radioByPlayer = [...summary].map(([name, s]) => ({
    name, team: s.team, calls: s.calls, grenades: s.grenades,
    top: [...s.counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([text, count]) => ({ text, count })),
  })).sort((a, b) => b.calls - a.calls || b.grenades - a.grenades);
  return { log, radioByPlayer };
}

/** Chat text as the game prints it ("*DEAD*(CT) name :   hi") → just the message ("hi"). */
function chatText(text: string, who: string): string {
  let t = text.replace(/^\*(DEAD|SPEC)\*\s*/, '').replace(/^\((Terrorist|Counter-Terrorist|Spectator|T|CT)\)\s*/i, '');
  if (t.startsWith(who)) {
    const mm = /^\s*:\s*/.exec(t.slice(who.length));
    if (mm) t = t.slice(who.length + mm[0].length);
  }
  return t.trim();
}

/** 5.m: every talk burst per player (reconnects added up by name), most talk first. */
export function voiceTimeline(m: MatchData): VoiceRow[] {
  const sides = playersByName(m);
  const rows = new Map<string, VoiceRow>();
  for (const b of m.voice) {
    const p = b.player === undefined ? undefined : m.players.find((x) => x.id === b.player);
    const name = p?.name || `Player in slot ${b.slot + 1}`;
    const row = rows.get(name) ?? { name, team: p ? sides.get(p.name)?.team ?? side(p.team) : undefined, bursts: [], seconds: 0 };
    row.bursts.push([b.start, b.end]);
    row.seconds += b.end - b.start;
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds);
}
