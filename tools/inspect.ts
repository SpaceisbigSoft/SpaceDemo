// Demo inspector (plan task 1.1): reports what is inside GoldSrc .dem files,
// with a focus on voice data. Usage:
//   npm run inspect -- <demo-or-folder> [...more] [--json out-folder]
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { readHeader, readDirectory, scanFrames, HEADER_SIZE, FrameType, type Frame } from '../engine/src/demo.js';
import { MessageParser, type ParseContext, type ServerInfo, type VoiceInit } from '../engine/src/messages.js';
import { mapChecksumFile } from '../engine/src/mapcrc.js';
import { existsSync } from 'node:fs';
import cstrike from '../engine/data/cstrike.json' with { type: 'json' };

/** Folder with the player's installed maps (cstrike/maps), set with --maps. */
let mapsDir: string | undefined;
const mapCrcCache = new Map<string, number | null>();
function installedMapChecksum(map: string): number | null {
  if (!mapsDir) return null;
  if (!mapCrcCache.has(map)) {
    const p = join(mapsDir, map + '.bsp');
    mapCrcCache.set(map, existsSync(p) ? mapChecksumFile(p) : null);
  }
  return mapCrcCache.get(map) ?? null;
}
function mapStatus(map: string, expected: number): string {
  if (!mapsDir) return 'not checked (use --maps)';
  const have = installedMapChecksum(map);
  if (have === null) return 'MISSING - map not installed';
  return have === expected ? 'OK - installed map matches' : `DIFFERENT VERSION - installed ${have}, demo needs ${expected}`;
}

interface VoiceStats {
  slot: number;
  name: string;
  packets: number;
  bytes: number;
  first: number;
  last: number;
  sizes: Map<number, number>;
  sample?: string;
}

interface Report {
  file: string;
  sizeBytes: number;
  header: ReturnType<typeof readHeader>;
  directory: { description: string; trackTime: number; frameCount: number; offset: number }[] | null;
  directoryProblem?: string;
  csVersion: string;
  betaSteam: boolean;
  perspective: 'POV' | 'HLTV';
  serverInfo?: ServerInfo;
  recorder?: string;
  durationSeconds: number;
  frames: number;
  gameDataFrames: number;
  messageErrors: number;
  firstErrors: string[];
  scanErrors: string[];
  players: { slot: number; name: string }[];
  voiceInits: VoiceInit[];
  voice: Omit<VoiceStats, 'sizes'>[] & { topSizes?: string }[];
  voiceTotalPackets: number;
  chatMessages: number;
  userMessages: number;
}

const versions = (cstrike as { Versions: { Name: string; Checksum: string }[] }).Versions;

function csVersionFor(checksum: string): string {
  return versions.find((v) => v.Checksum === checksum)?.Name ?? '1.6 (or unknown client.dll)';
}

export function inspect(file: string): Report {
  const buf = readFileSync(file);
  const header = readHeader(buf);
  const dir = readDirectory(buf, header);
  const report: Report = {
    file,
    sizeBytes: buf.length,
    header,
    directory: dir?.map((d) => ({ description: d.description, trackTime: d.trackTime, frameCount: d.frameCount, offset: d.offset })) ?? null,
    csVersion: '?',
    betaSteam: false,
    perspective: 'POV',
    durationSeconds: 0,
    frames: 0,
    gameDataFrames: 0,
    messageErrors: 0,
    firstErrors: [],
    scanErrors: [],
    players: [],
    voiceInits: [],
    voice: [],
    voiceTotalPackets: 0,
    chatMessages: 0,
    userMessages: 0,
  };
  if (header.magic !== 'HLDEMO') throw new Error(`Not a GoldSrc demo (magic "${header.magic}")`);

  // Which byte ranges to scan: each directory entry, or the whole file if the directory is broken.
  const ranges: { start: number; limit: number }[] = [];
  if (dir) {
    for (const d of dir) ranges.push({ start: d.offset, limit: header.directoryOffset });
  } else {
    report.directoryProblem = header.directoryOffset === 0 ? 'No directory (recording was not closed properly)' : 'Directory unreadable';
    ranges.push({ start: HEADER_SIZE, limit: buf.length });
  }

  const ctx: ParseContext = { networkProtocol: header.networkProtocol, gameDir: header.gameDir, betaSteam: false, hltv: false };
  const players = new Map<number, string>();
  const voice = new Map<number, VoiceStats>();
  const parser = new MessageParser(ctx, {
    serverInfo: (si) => {
      report.serverInfo = si;
      report.csVersion = header.gameDir === 'cstrike' ? csVersionFor(si.clientDllChecksum) : 'n/a';
      // Beta Steam: protocol 46 recorded with a 1.6 client.dll (COL's rule).
      ctx.betaSteam = header.networkProtocol === 46 && header.gameDir === 'cstrike' && !versions.some((v) => v.Checksum === si.clientDllChecksum);
      report.betaSteam = ctx.betaSteam;
    },
    userInfo: (p) => {
      if (p.name) players.set(p.slot, p.name);
    },
    voiceInit: (v) => report.voiceInits.push(v),
    voiceData: (v) => {
      let s = voice.get(v.slot);
      if (!s) {
        s = { slot: v.slot, name: '', packets: 0, bytes: 0, first: v.time, last: v.time, sizes: new Map() };
        s.sample = Buffer.from(v.data.subarray(0, 32)).toString('hex');
        voice.set(v.slot, s);
      }
      s.packets++;
      s.bytes += v.data.length;
      s.last = v.time;
      s.sizes.set(v.data.length, (s.sizes.get(v.data.length) ?? 0) + 1);
    },
    userMessage: (name) => {
      report.userMessages++;
      if (name === 'SayText' || name === 'TextMsg') {
        if (name === 'SayText') report.chatMessages++;
      }
    },
  });

  const allFrames: Frame[] = [];
  for (const r of ranges) {
    const res = scanFrames(buf, r.start, header.networkProtocol, r.limit);
    if (res.error) report.scanErrors.push(`${res.error} at offset ${res.endOffset}`);
    for (const fr of res.frames) allFrames.push(fr);
  }
  report.frames = allFrames.length;
  for (const f of allFrames) {
    if (f.messages && (f.type === FrameType.GameData || f.type === FrameType.GameDataLoading)) {
      report.gameDataFrames++;
      try {
        parser.parseFrame(f.messages, f.time);
      } catch (e) {
        report.messageErrors++;
        if (report.firstErrors.length < 5) report.firstErrors.push(`t=${f.time.toFixed(2)}s frame ${f.number}: ${(e as Error).message}`);
      }
    }
    if (f.time > report.durationSeconds) report.durationSeconds = f.time;
  }

  report.perspective = ctx.hltv ? 'HLTV' : 'POV';
  report.players = [...players.entries()].sort((a, b) => a[0] - b[0]).map(([slot, name]) => ({ slot, name }));
  if (report.serverInfo && !ctx.hltv) report.recorder = players.get(report.serverInfo.recorderSlot) ?? `slot ${report.serverInfo.recorderSlot}`;
  report.voice = [...voice.values()]
    .sort((a, b) => b.packets - a.packets)
    .map((s) => {
      const top = [...s.sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sz, n]) => `${sz}B×${n}`).join(' ');
      // svc_voicedata slot is the entity index - 1 for players.
      return { slot: s.slot, name: players.get(s.slot) ?? '?', packets: s.packets, bytes: s.bytes, first: s.first, last: s.last, sample: s.sample, topSizes: top };
    });
  report.voiceTotalPackets = report.voice.reduce((n, v) => n + v.packets, 0);
  return report;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function printReport(r: Report): void {
  const h = r.header;
  console.log(`\n=== ${basename(r.file)} (${(r.sizeBytes / 1e6).toFixed(1)} MB)`);
  console.log(`  Format: ${h.magic} demo protocol ${h.demoProtocol}, network protocol ${h.networkProtocol}${r.betaSteam ? ' (beta Steam)' : ''} · game ${h.gameDir} · CS version ${r.csVersion}`);
  console.log(`  Map: ${h.mapName} (checksum ${h.mapChecksum}) · ${r.perspective}${r.recorder ? ` recorded by ${r.recorder}` : ''} · server "${r.serverInfo?.serverName ?? '?'}" · max ${r.serverInfo?.maxClients ?? '?'} players`);
  console.log(`  Map file: ${mapStatus(h.mapName, h.mapChecksum)}`);
  console.log(`  Length: ${fmtTime(r.durationSeconds)} · ${r.frames} frames (${r.gameDataFrames} with network data)`);
  console.log(`  Directory: ${r.directory ? r.directory.map((d) => `${d.description} ${fmtTime(d.trackTime)} ${d.frameCount} frames`).join(' | ') : 'MISSING - ' + r.directoryProblem}`);
  console.log(`  Health: ${r.messageErrors === 0 && r.scanErrors.length === 0 ? 'OK - every frame and message read cleanly' : `${r.messageErrors} frames with message errors; ${r.scanErrors.length} scan problems`}`);
  for (const e of [...r.scanErrors, ...r.firstErrors]) console.log(`    ! ${e}`);
  console.log(`  Players (${r.players.length}): ${r.players.map((p) => p.name).join(', ')}`);
  console.log(`  Chat messages: ${r.chatMessages}`);
  const vi = r.voiceInits.map((v) => `${v.codec}${v.quality !== undefined ? ` q${v.quality}` : ''}`);
  console.log(`  Voice codec: ${vi.length ? [...new Set(vi)].join(', ') : 'none declared'} · ${r.voiceTotalPackets} voice packets from ${r.voice.length} players`);
  for (const v of r.voice) {
    console.log(`    slot ${String(v.slot).padStart(2)} ${v.name.padEnd(24).slice(0, 24)} ${String(v.packets).padStart(5)} packets ${(v.bytes / 1024).toFixed(0).padStart(5)} KB  ${fmtTime(v.first)}–${fmtTime(v.last)}  sizes: ${v.topSizes}`);
  }
}

function collect(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p)) out.push(...collect([join(p, e)]));
    } else if (extname(p).toLowerCase() === '.dem') out.push(p);
  }
  return out.sort();
}

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
let jsonDir: string | undefined;
if (jsonIdx >= 0) {
  jsonDir = args[jsonIdx + 1];
  args.splice(jsonIdx, 2);
}
const mapsIdx = args.indexOf('--maps');
if (mapsIdx >= 0) {
  mapsDir = args[mapsIdx + 1];
  args.splice(mapsIdx, 2);
}
if (args.length === 0) {
  console.log('Usage: npm run inspect -- <demo-or-folder> [...] [--json out-folder] [--maps <cstrike/maps folder>]');
  process.exit(1);
}
const files = collect(args);
const summary: Record<string, unknown>[] = [];
for (const f of files) {
  try {
    const r = inspect(f);
    printReport(r);
    summary.push({
      file: basename(f), protocol: r.header.networkProtocol, cs: r.csVersion, beta: r.betaSteam, type: r.perspective, map: r.header.mapName,
      mapFile: mapStatus(r.header.mapName, r.header.mapChecksum).split(' ')[0],
      length: fmtTime(r.durationSeconds), errors: r.messageErrors + r.scanErrors.length,
      codec: [...new Set(r.voiceInits.map((v) => v.codec + (v.quality !== undefined ? ` q${v.quality}` : '')))].join(','),
      voicePackets: r.voiceTotalPackets, voicePlayers: r.voice.length, players: r.players.length, chat: r.chatMessages,
    });
    if (jsonDir) {
      mkdirSync(jsonDir, { recursive: true });
      writeFileSync(join(jsonDir, basename(f, '.dem') + '.json'), JSON.stringify(r, null, 2));
    }
  } catch (e) {
    console.log(`\n=== ${basename(f)}: FAILED - ${(e as Error).message}`);
    summary.push({ file: basename(f), failed: (e as Error).message });
  }
}
console.log('\n=== Summary');
console.table(summary);
