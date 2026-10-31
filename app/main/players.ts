// 5.p Player totals across demos: one summary per demo (scoreboard numbers + a settings fingerprint per player), and
// from all of them the totals per player, with names merged by the owner and suggestions for renamed players.
// Recordings of the same match half (POV + HLTV of the same rounds) are counted once.
import { createHash } from 'node:crypto';
import type { MatchData } from '../../engine/src/match/types.js';
import type { DemoPlayers, PlayerFingerprint, PlayerTotals, PlayersView, RenameSuggestion } from '../shared/api.js';
import { playersByName, statRows } from './details-extra.js';
import { teamTag } from './details.js';

/** Userinfo keys that change with the team or the moment, not with the person. */
const VOLATILE = new Set(['name', 'team', 'model', '*hltv', 'hltv_specs', 'hltv_slots', 'hltv_delay']);
/** Settings that say something about the person (shown when two players match). */
const SETTINGS = ['topcolor', 'bottomcolor', 'rate', 'cl_updaterate', 'cl_lw', 'cl_lc', 'cl_dlmax', 'lefthand', 'dm', 'ah', 'vgui_menus', 'friends', 'ghosts'];
const isSecret = (key: string) => /pw|pass/i.test(key);

/** What a player's userinfo says about him. Secret values (setinfo passwords) are only kept as a hash, never shown. */
export function fingerprint(info: Record<string, string> | undefined): PlayerFingerprint {
  const fp: PlayerFingerprint = { ids: {}, secrets: [], keys: '', settings: {} };
  if (!info) return fp;
  const keys: string[] = [];
  for (const [k, v] of Object.entries(info)) {
    if (VOLATILE.has(k)) continue;
    keys.push(k);
    if (k.startsWith('*')) fp.ids[k] = v;
    else if (isSecret(k)) fp.secrets.push(createHash('sha256').update(`${k}=${v}`).digest('hex').slice(0, 16));
    else if (SETTINGS.includes(k)) fp.settings[k] = String(Number.isFinite(Number(v)) ? Number(v) : v);
  }
  fp.keys = keys.sort().join(',');
  return fp;
}

/** One demo's players: scoreboard numbers and fingerprints (counted from the kill feed, like the Scoreboard tab). */
export function demoPlayers(m: MatchData, demo: { key: string; name: string; date: number; map: string }): DemoPlayers {
  const sides = playersByName(m);
  const stats = statRows(m);
  const players = stats.map((s) => {
    const conns = m.players.filter((p) => sides.get(s.name)?.ids.includes(p.id));
    const info = conns.map((p) => p.userinfo).filter(Boolean).at(-1);
    return {
      name: s.name, team: s.team, recorder: s.recorder,
      kills: s.kills, deaths: s.deaths, headshots: s.headshots, teamKills: s.teamKills, suicides: s.suicides,
      firstKills: s.firstKills, multi3: s.multiKills[3] + s.multiKills[4] + s.multiKills[5], clutches: s.clutches.length,
      fp: fingerprint(info),
      // Other names the same connection used in this demo (renamed while playing).
      otherNames: [...new Set(conns.flatMap((p) => p.names))].filter((n) => n && n !== s.name),
    };
  });
  const tags = { T: teamTag(players.filter((p) => p.team === 'T').map((p) => p.name)), CT: teamTag(players.filter((p) => p.team === 'CT').map((p) => p.name)) };
  // Same match half = same map, same round results in order, same kills per player.
  const signature = `${m.map}|${m.rounds.map((r) => (r.winner ?? '?')[0]).join('')}|${players.map((p) => `${p.name}:${p.kills}/${p.deaths}`).sort().join(',')}`;
  return {
    key: demo.key, name: demo.name, date: demo.date, map: demo.map, recording: m.recording, rounds: m.rounds.length,
    players: players.map((p) => ({ ...p, tag: tags[p.team] })), signature,
  };
}

/** How alike two players' fingerprints are, with the reasons in plain words. */
export function likeness(a: PlayerFingerprint, b: PlayerFingerprint, tagA?: string, tagB?: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const [k, v] of Object.entries(a.ids)) {
    if (b.ids[k] === v) { score += 100; reasons.push(`same ${k.replace(/^\*/, '')} id`); }
    else if (b.ids[k] !== undefined) { score -= 100; reasons.push(`different ${k.replace(/^\*/, '')} id`); }
  }
  const shared = a.secrets.filter((s) => b.secrets.includes(s)).length;
  if (shared) { score += 40; reasons.push('same private setting (a setinfo password; value hidden)'); }
  if (a.keys && a.keys === b.keys) { score += 20; reasons.push('same list of game settings'); }
  if (a.settings.topcolor !== undefined && a.settings.topcolor === b.settings.topcolor && a.settings.bottomcolor === b.settings.bottomcolor) { score += 10; reasons.push(`same colours (${a.settings.topcolor}/${a.settings.bottomcolor})`); }
  for (const k of ['rate', 'cl_updaterate']) {
    if (a.settings[k] !== undefined && a.settings[k] === b.settings[k]) { score += 5; reasons.push(`same ${k} ${a.settings[k]}`); }
  }
  let small = 0;
  for (const k of ['cl_dlmax', 'lefthand', 'dm', 'ah', 'vgui_menus', 'friends', 'ghosts']) if (a.settings[k] !== undefined && a.settings[k] === b.settings[k]) small++;
  if (small >= 3) { score += 2 * small; reasons.push(`${small} other settings the same`); }
  if (tagA && tagB) {
    if (tagA === tagB) { score += 10; reasons.push(`same clan tag ${tagA}`); }
    else { score -= 20; reasons.push(`different clan tags (${tagA}, ${tagB})`); }
  }
  return { score, reasons };
}

/** Suggest a merge from this score on. */
export const SUGGEST_FROM = 60;

/**
 * Totals per player over all demos. `merges` maps an alias to the name it belongs to (the owner's choices);
 * `rejected` lists pairs ("a|b", sorted) the owner said are different people.
 */
export function playerTotals(demos: DemoPlayers[], merges: Record<string, string>, rejected: string[]): PlayersView {
  // Same match half recorded more than once (POV + HLTV): count it once — the recording with the most rounds; the
  // others are listed with it. Same half = same map, the shorter one's round results (6+) found in order in the longer
  // one, and 6+ of its players in both.
  const counted: DemoPlayers[] = [];
  const sameAs = new Map<string, string>();
  const order = [...demos].sort((a, b) => b.rounds - a.rounds || (a.recording === 'HLTV' ? 1 : 0) - (b.recording === 'HLTV' ? 1 : 0) || a.date - b.date);
  for (const d of order) {
    const twin = counted.find((c) => sameHalf(c, d));
    if (twin) sameAs.set(d.key, twin.key); else counted.push(d);
  }
  const canon = (n: string) => { let c = n; for (let i = 0; i < 10 && merges[c]; i++) c = merges[c]; return c; };
  const totals = new Map<string, PlayerTotals>();
  for (const d of counted) {
    for (const p of d.players) {
      const name = canon(p.name);
      const t = totals.get(name) ?? { name, aliases: [], tags: [], demos: 0, rounds: 0, kills: 0, deaths: 0, headshots: 0, teamKills: 0, firstKills: 0, multi3: 0, clutches: 0, demoKeys: [] };
      if (p.name !== name && !t.aliases.includes(p.name)) t.aliases.push(p.name);
      if (p.tag && !t.tags.includes(p.tag)) t.tags.push(p.tag);
      t.demos++; t.rounds += d.rounds; t.kills += p.kills; t.deaths += p.deaths; t.headshots += p.headshots;
      t.teamKills += p.teamKills; t.firstKills += p.firstKills; t.multi3 += p.multi3; t.clutches += p.clutches;
      t.demoKeys.push(d.key);
      totals.set(name, t);
    }
  }

  // Rename suggestions: pairs of (merged) names never present in the same demo at the same time, with alike settings.
  const together = new Set<string>();
  const seenFp = new Map<string, { fp: PlayerFingerprint; tag?: string }[]>();
  for (const d of demos) {
    const names = d.players.map((p) => canon(p.name));
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) together.add([names[i], names[j]].sort().join('|'));
    for (const p of d.players) seenFp.set(canon(p.name), [...(seenFp.get(canon(p.name)) ?? []), { fp: p.fp, tag: p.tag }]);
  }
  const suggestions: RenameSuggestion[] = [];
  const names = [...totals.keys()];
  // Renamed while playing (same connection, other name): certain, but still the owner's choice.
  for (const d of demos) for (const p of d.players) for (const o of p.otherNames) {
    const a = canon(p.name), b = canon(o);
    const pair = [a, b].sort().join('|');
    if (a === b || rejected.includes(pair) || !totals.has(b) || suggestions.some((s) => [s.a, s.b].sort().join('|') === pair)) continue;
    suggestions.push({ a, b, score: 200, reasons: [`renamed from ${o} to ${p.name} while playing (${d.name})`] });
  }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const pair = [names[i], names[j]].sort().join('|');
      if (together.has(pair) || rejected.includes(pair) || suggestions.some((s) => [s.a, s.b].sort().join('|') === pair)) continue;
      let best: { score: number; reasons: string[] } | undefined;
      for (const a of seenFp.get(names[i]) ?? []) for (const b of seenFp.get(names[j]) ?? []) {
        const l = likeness(a.fp, b.fp, a.tag, b.tag);
        if (!best || l.score > best.score) best = l;
      }
      if (best && best.score >= SUGGEST_FROM) suggestions.push({ a: names[i], b: names[j], score: best.score, reasons: best.reasons });
    }
  }
  suggestions.sort((x, y) => y.score - x.score);
  return {
    players: [...totals.values()].sort((a, b) => b.kills - a.kills),
    suggestions,
    demos: demos.map((d) => ({ key: d.key, name: d.name, date: d.date, map: d.map, recording: d.recording, countedAs: sameAs.get(d.key) })),
    merges,
  };
}

/** True if `short` is a recording of (part of) the same match half as `long` (see playerTotals). */
export function sameHalf(long: DemoPlayers, short: DemoPlayers): boolean {
  const [mapL, winL] = long.signature.split('|');
  const [mapS, winS] = short.signature.split('|');
  if (mapL !== mapS || winS.length < 6 || !winL.includes(winS)) return false;
  const names = new Set(long.players.map((p) => p.name));
  return short.players.filter((p) => names.has(p.name)).length >= 6;
}
