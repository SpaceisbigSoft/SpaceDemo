// Demo details (plan 4.4): turns the engine's match data (2.12), the inspector's voice numbers and the map facts
// (2.14) into what the details page shows. Only reads files.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { inspectParsed } from '../../engine/src/inspect.js';
import { applySiteLetters, readMapFacts } from '../../engine/src/map/bsp.js';
import { parseOverview, projection } from '../../engine/src/map/overview.js';
import { checkMatch, extractMatch } from '../../engine/src/match/extract.js';
import type { MatchData, Team } from '../../engine/src/match/types.js';
import { readZipEntry } from '../../engine/src/zip.js';
import type { DemoDetails, DetailsMap, PlayerRow, TeamDetails } from '../shared/api.js';
import { heatmapAndProjection } from './heatmap.js';
import { replayData, type EstimateInput } from './replay.js';
import { sightingsData } from './sightings.js';
import { readSight } from '../../engine/src/map/sight.js';
import { buildWalkMap, observationsFrom } from '../../engine/src/map/walk.js';
import type { Projection } from '../../engine/src/map/overview.js';
import type { HeatKill, ReplayData } from '../shared/api.js';
import { chatRadioLog, overviewInfo, periods, playersByName, roundDetails, statRows, voiceTimeline } from './details-extra.js';

export interface DetailsJob {
  key: string;
  file: string;
  zipEntry?: string;
  /** The .bsp with exactly this demo's map version, if known. */
  mapFile?: string;
  /** The game's overview description (cstrike\overviews\<map>.txt), used only when mapIsInstalled. */
  overviewTxt?: string;
  /** True when mapFile is the game's own installed map (so today's overview picture fits). */
  mapIsInstalled: boolean;
}

const REASON_CODE: Record<string, string> = {
  eliminated: 'K', 'bomb exploded': 'B', 'bomb defused': 'D', 'time ran out': 'T', draw: '=',
};

/** The clan tag most of a team shares: a name part (letters/digits, 2+ long) used by at least half, and by 2+ players. */
export function teamTag(names: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const n of names) {
    for (const t of new Set(n.split(/[^A-Za-z0-9]+/).filter((x) => x.length >= 2))) count.set(t, (count.get(t) ?? 0) + 1);
  }
  const need = Math.max(2, Math.ceil(names.length / 2));
  const best = [...count].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  return best?.[0];
}

/** Chat text as the game prints it ("*DEAD* (Terrorist) name :   hi") → just the message ("hi"). */
export function chatMessage(text: string, who: string | undefined): string {
  let t = text.replace(/^\*DEAD\*\s*/, '').replace(/^\((Terrorist|Counter-Terrorist|Spectator|T|CT)\)\s*/i, '');
  if (who && t.startsWith(who)) {
    const rest = t.slice(who.length);
    const m = /^\s*:\s*/.exec(rest);
    if (m) t = rest.slice(m[0].length);
  }
  return t.trim();
}

export function buildDetails(m: MatchData, talkByName: Map<string, number>, job: Pick<DetailsJob, 'key'>, map: DetailsMap): Omit<DemoDetails, 'overview' | 'roundDetails' | 'stats' | 'periods' | 'log' | 'radioByPlayer' | 'voice' | 'seconds' | 'heatmap'> {
  // Players per side from the stats (sides from the kill events; reconnects added up by name).
  const stats = statRows(m);
  const team = (t: 'T' | 'CT'): TeamDetails => {
    const players: PlayerRow[] = stats.filter((p) => p.team === t).map((p) => ({
      name: p.name, kills: p.kills, deaths: p.deaths, headshots: p.headshots, talkSeconds: talkByName.get(p.name) ?? 0, recorder: p.recorder,
    }));
    return { tag: teamTag(players.map((p) => p.name)), players, heard: players.some((p) => p.talkSeconds > 0) };
  };
  const asTeam = (t: Team | undefined) => (t === 'T' || t === 'CT' ? t : undefined);
  const teamOf = (id: number | undefined) => asTeam(m.players.find((p) => p.id === id)?.team);
  // A name can belong to more than one connection (reconnects): use the one that played on a team.
  const sides = playersByName(m);
  const teamOfName = (name: string) => sides.get(name)?.team;

  const check = checkMatch(m);
  const score = check.serverScore
    ? { ...check.serverScore, source: 'server' as const, matchesRounds: check.roundsMatch }
    : m.rounds.length ? { ...check.roundsWon, source: 'rounds' as const, matchesRounds: true } : undefined;

  const talk = [...talkByName].filter(([, s]) => s > 0).map(([name, seconds]) => ({
    name, seconds, team: teamOfName(name),
  })).sort((a, b) => b.seconds - a.seconds);

  return {
    key: job.key,
    teams: { T: team('T'), CT: team('CT') },
    score,
    rounds: m.rounds.map((r) => ({ number: r.number, winner: r.winner, reason: r.reason ? REASON_CODE[r.reason] ?? 'O' : undefined })),
    chat: m.chat.map((c) => {
      const who = m.players.find((p) => p.id === c.sender)?.name;
      return { time: c.time, who, team: who ? teamOfName(who) : teamOf(c.sender), text: chatMessage(c.text, who), teamOnly: c.teamOnly, dead: c.dead };
    }),
    talk,
    talkBursts: m.voice.length,
    map,
    restarts: m.restarts,
  };
}

/**
 * The game's overview pictures use pure green (0, 255, 0) for "no floor here" (the game hides it). Paletted (8-bit)
 * pictures get that palette colour changed to a dark grey, on a copy in memory; the file is only read.
 */
export function keyOutGreen(bmp: Buffer, to: [number, number, number] = [14, 16, 18]): Buffer {
  const out = Buffer.from(bmp);
  if (out.length < 54 || out.toString('latin1', 0, 2) !== 'BM') return out;
  const headerSize = out.readUInt32LE(14), bpp = out.readUInt16LE(28);
  if (bpp !== 8) return out;
  const colours = out.readUInt32LE(46) || 256;
  for (let i = 0; i < colours; i++) {
    const o = 14 + headerSize + i * 4; // blue, green, red, reserved
    if (o + 3 >= out.length) break;
    if (out[o] === 0 && out[o + 1] === 255 && out[o + 2] === 0) { out[o] = to[2]; out[o + 1] = to[1]; out[o + 2] = to[0]; }
  }
  return out;
}

/** Overview picture and bomb sites, when today's picture fits this map version. */
export function detailsMap(job: DetailsJob, mapName: string, checksum: number): DetailsMap {
  if (!job.mapFile) return { sites: [], note: "This demo's map version wasn't found, so there's no map picture." };
  let sites: { letter: string; x: number; y: number }[] = [];
  let facts;
  try { facts = readMapFacts(readFileSync(job.mapFile)); } catch { /* unreadable map: no sites */ }
  if (!job.mapIsInstalled || !job.overviewTxt || !existsSync(job.overviewTxt)) {
    return { sites: [], note: job.mapIsInstalled ? "The game has no overview picture for this map." : "This is an old version of the map; today's overview picture doesn't match it." };
  }
  try {
    const ov = parseOverview(readFileSync(job.overviewTxt, 'latin1'));
    // IMAGE is relative to the game's mod folder (e.g. "overviews/de_train.bmp").
    const imagePath = join(dirname(dirname(job.overviewTxt)), ov.image || `overviews/${mapName}.bmp`);
    const image = `data:image/bmp;base64,${keyOutGreen(readFileSync(imagePath)).toString('base64')}`;
    if (facts) {
      const project = projection(ov);
      sites = applySiteLetters(facts.bombSites, mapName, checksum).map((s) => {
        const [x, y] = project((s.mins[0] + s.maxs[0]) / 2, (s.mins[1] + s.maxs[1]) / 2);
        return { letter: s.letter, x: Math.round(x), y: Math.round(y) };
      });
    }
    return { image, sites };
  } catch {
    return { sites: [], note: "The overview picture couldn't be read." };
  }
}

/** 5.k: heatmaps over the overview picture when it fits, else over the floor drawn from the map file. */
function heatmap(job: DetailsJob, m: MatchData, mapName: string, checksum: number, pictureShown: boolean) {
  let bsp: Uint8Array | undefined;
  try { if (job.mapFile) bsp = new Uint8Array(readFileSync(job.mapFile)); } catch { /* unreadable map */ }
  // Same picture as the Overview tab's map card (only when it fits this map version).
  let overview: { project: ReturnType<typeof projection> } | undefined;
  if (pictureShown && job.overviewTxt) {
    try { overview = { project: projection(parseOverview(readFileSync(job.overviewTxt, 'latin1'))) }; } catch { /* drawn from the map file */ }
  }
  return heatmapAndProjection({ m, mapName, checksum, bsp, overview });
}

/** Line of sight through this demo's map version (5.q), when the map file is known. */
function sightFor(mapFile?: string) {
  if (!mapFile) return undefined;
  try { return readSight(new Uint8Array(readFileSync(mapFile))); } catch { return undefined; }
}

/** The last demo read for the details page, kept for the radar replay (5.j) so a round opens without reading again. */
let lastRead: { key: string; m: MatchData; project: Projection; kills: HeatKill[]; mapFile?: string; est?: EstimateInput } | undefined;

/** 5.j: one round for the radar replay (reads the demo first if it isn't the last one read). */
export function readReplay(job: DetailsJob, round: number): ReplayData | { error: string } {
  if (lastRead?.key !== job.key) {
    const d = readDetails(job);
    if ('error' in d) return d;
  }
  try {
    const lr = lastRead!;
    // The walk map is built once per demo, the first time a round is opened (about 1–2 s).
    if (!lr.est && lr.mapFile) {
      try {
        const bsp = new Uint8Array(readFileSync(lr.mapFile));
        const facts = readMapFacts(bsp);
        lr.est = { walk: buildWalkMap(bsp, { observations: observationsFrom(lr.m.tracks ?? []) }), spawns: { T: facts.spawnsT, CT: facts.spawnsCT } };
      } catch { lr.est = { spawns: { T: [], CT: [] } }; }
    }
    return replayData(lr.m, lr.project, lr.kills, round, lr.est);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Reads the demo and builds its details (runs in the background thread). */
export function readDetails(job: DetailsJob): DemoDetails | { error: string } {
  try {
    const bytes = job.zipEntry ? readZipEntry(job.file, job.zipEntry) : readFileSync(job.file);
    const demo = readDemo(bytes);
    const report = inspectParsed(demo, bytes.length);
    const m = extractMatch(demo, { tracks: true });
    const talk = new Map<string, number>();
    if (report.players.some((p) => p.voiceSeconds !== undefined)) {
      // Miles voice: measured from the voice data (same numbers as the library).
      for (const p of report.players) if (p.name && !p.isHltv && p.voiceSeconds) talk.set(p.name, (talk.get(p.name) ?? 0) + p.voiceSeconds);
    } else {
      // Other codecs: the length of each talk burst.
      for (const b of m.voice) {
        const name = m.players.find((p) => p.id === b.player)?.name;
        if (name) talk.set(name, (talk.get(name) ?? 0) + (b.end - b.start));
      }
    }
    const ps = periods(m, report.seconds);
    const map = detailsMap(job, report.maps[0] ?? report.mapName, report.mapChecksum);
    const heat = heatmap(job, m, report.maps[0] ?? report.mapName, report.mapChecksum, !!map.image);
    lastRead = { key: job.key, m, project: heat.project, kills: heat.data.kills, mapFile: job.mapFile };
    return {
      ...buildDetails(m, talk, job, map),
      overview: overviewInfo(report, m),
      roundDetails: roundDetails(m),
      stats: statRows(m),
      periods: ps,
      ...chatRadioLog(m, ps, report.hostName),
      voice: voiceTimeline(m),
      seconds: ps[ps.length - 1].end,
      heatmap: heat.data,
      sightings: sightingsData(m, heat.project, heat.data.sites, sightFor(job.mapFile)),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
