// Demo inspector: a plain summary of what a demo is and what state it is in.
// Used by tools/inspect.ts now, and by the app's health report later (plan 2.5).
import { readDemo } from './container/read.js';
import { FrameType, type DemoFile } from './container/types.js';
import { createState, decodeMessages, MessageError, type ProtocolState } from './protocol/messages.js';
import { Svc } from './protocol/ids.js';

/** Miles voice (Voxware MetaVoice VR12): 6-byte frames of 22.5 ms. See docs/FORMAT.md. */
const MILES_FRAME_BYTES = 6;
const MILES_FRAME_SECONDS = 0.0225;
/** Voice packets further apart than this start a new talk burst. */
const BURST_GAP_SECONDS = 0.3;

export interface InspectSection {
  description: string;
  /** Length in seconds (directory value, or the last frame time when the directory is missing). */
  seconds: number;
  /** All frames in the section. */
  frames: number;
  /** Network-message frames (type 1): the number the directory stores as the section's frame count. */
  netFrames: number;
  /** Frame count stored in the directory, when there is one. */
  directoryFrames?: number;
}

export interface InspectPlayer {
  /** Client slot (0-based, as used by svc_voicedata). */
  slot: number;
  name: string;
  /** Last team seen in a TeamInfo message ("CT", "TERRORIST", "SPECTATOR", or "" if none). */
  team: string;
  isHltv: boolean;
  isRecorder: boolean;
  /** Network settings from the player's userinfo (as sent; later changes are listed in `settingChanges`). */
  rate?: string;
  updateRate?: string;
  /** cl_lw (client weapon prediction) and cl_lc (lag compensation). */
  clientWeapons?: string;
  lagCompensation?: string;
  settingChanges: { time: number; setting: string; value: string }[];
  voicePackets: number;
  /** Packets with no voice bytes (the recorder's own microphone is stored this way). */
  emptyVoicePackets: number;
  voiceBytes: number;
  /** Seconds of voice, when the codec's frame timing is known (Miles), else undefined. */
  voiceSeconds?: number;
  talkBursts: number;
}

export interface InspectReport {
  fileSize: number;
  magic: string;
  demoProtocol: number;
  networkProtocol: number;
  gameDir: string;
  mapName: string;
  mapChecksum: number;
  /** Server build number found in the server's welcome text, if any. */
  serverBuild?: number;
  hostName?: string;
  maxClients?: number;
  /** "HLTV" when recorded by an HLTV proxy, "POV" when recorded by a player. */
  recording: 'HLTV' | 'POV';
  /** Maps played, in order (more than one means a map change during playback: viewdemo can't play it). */
  maps: string[];
  /** Maps loaded earlier in the loading section and then left (the converter drops these loads). */
  loadingOnlyMaps: string[];
  directoryOk: boolean;
  recovered: boolean;
  sections: InspectSection[];
  /** Total playback length in seconds. */
  seconds: number;
  voiceCodec?: string;
  voiceQuality?: number;
  /** Server updates the recorder actually received per second of playback (network frames / length). */
  measuredUpdatesPerSecond?: number;
  /** The recorder's frame rate during playback (client-data frames / length). */
  measuredFps?: number;
  players: InspectPlayer[];
  /** Problems in plain language. Empty for a healthy demo. */
  problems: string[];
}

function asciiz(bytes: Uint8Array): string {
  let s = '';
  for (const c of bytes) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Inspects a demo from its bytes. Never throws for damaged demos; damage is listed in `problems`. */
export function inspectDemo(bytes: Uint8Array): InspectReport {
  const demo = readDemo(bytes);
  return inspectParsed(demo, bytes.length);
}

export function inspectParsed(demo: DemoFile, fileSize: number): InspectReport {
  const h = demo.header;
  const problems = [...demo.problems];
  const state: ProtocolState = createState(h.networkProtocol, h.gameDir);

  const players = new Map<number, InspectPlayer>();
  const player = (slot: number): InspectPlayer => {
    let p = players.get(slot);
    if (!p) {
      p = { slot, name: '', team: '', isHltv: false, isRecorder: false, settingChanges: [], voicePackets: 0, emptyVoicePackets: 0, voiceBytes: 0, talkBursts: 0 };
      players.set(slot, p);
    }
    return p;
  };
  const lastVoiceTime = new Map<number, number>();

  const report: InspectReport = {
    fileSize,
    magic: h.magic,
    demoProtocol: h.demoProtocol,
    networkProtocol: h.networkProtocol,
    gameDir: h.gameDir,
    mapName: h.mapName,
    mapChecksum: h.mapChecksum,
    recording: 'POV',
    maps: [],
    loadingOnlyMaps: [],
    directoryOk: !demo.recovered,
    recovered: demo.recovered,
    sections: [],
    seconds: 0,
    players: [],
    problems,
  };
  let recorderSlot: number | undefined;

  let decodeFailed = false;
  let sectionIndex = -1;
  const mapLoads: { name: string; section: number }[] = [];
  for (const section of demo.sections) {
    sectionIndex++;
    const last = section.frames[section.frames.length - 1];
    const seconds = section.entry ? section.entry.trackTime : last?.time ?? 0;
    report.sections.push({
      description: section.entry?.description ?? '(recovered)',
      seconds,
      frames: section.frames.length,
      netFrames: section.frames.filter((f) => f.type === FrameType.NetMessages).length,
      directoryFrames: section.entry?.frameCount,
    });
    const s = report.sections[report.sections.length - 1];
    if (s.directoryFrames !== undefined && s.directoryFrames !== s.netFrames) {
      problems.push(`Section "${s.description}": the directory says ${s.directoryFrames} frames but ${s.netFrames} were found.`);
    }
    if (section.entry?.description.toLowerCase() === 'playback' || (!section.entry && report.sections.length > 1)) report.seconds += seconds;

    for (const f of section.frames) {
      if (decodeFailed) break;
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      let messages;
      try {
        messages = decodeMessages(f.messages, state);
      } catch (e) {
        if (!(e instanceof MessageError)) throw e;
        problems.push(`Could not read the messages at ${f.time.toFixed(2)} s (frame ${f.index}): ${e.message}. The rest of the demo was not inspected.`);
        messages = e.partial;
        decodeFailed = true;
      }
      for (const m of messages) {
        const b = m.body;
        if (m.id === Svc.Print && m.start !== undefined && m.end !== undefined) {
          const text = asciiz(f.messages.subarray(m.start + 1, m.end));
          const build = /BUILD\s+(\d+)/i.exec(text);
          if (build && report.serverBuild === undefined) report.serverBuild = Number(build[1]);
        }
        if (!b) continue;
        switch (b.kind) {
          case 'serverInfo':
            report.hostName = b.hostName;
            report.maxClients = b.maxClients;
            recorderSlot = b.playerSlot;
            {
              // Server info gives "maps/de_train.bsp"; keep just "de_train".
              const name = b.mapName.replace(/^maps[\\/]/i, '').replace(/\.bsp$/i, '');
              mapLoads.push({ name, section: sectionIndex });
            }
            break;
          case 'hltv':
            report.recording = 'HLTV';
            break;
          case 'userInfo': {
            const p = player(b.slot);
            if (b.info.name !== undefined) p.name = b.info.name;
            if (b.info['*hltv'] !== undefined) p.isHltv = true;
            const settings: [keyof InspectPlayer & string, string][] = [['rate', 'rate'], ['updateRate', 'cl_updaterate'], ['clientWeapons', 'cl_lw'], ['lagCompensation', 'cl_lc']];
            for (const [field, key] of settings) {
              const v = b.info[key];
              if (v === undefined) continue;
              const old = p[field] as string | undefined;
              if (old === undefined) (p as unknown as Record<string, string>)[field] = v;
              else if (Number(old) !== Number(v)) {
                p.settingChanges.push({ time: f.time, setting: key, value: v });
                (p as unknown as Record<string, string>)[field] = v;
              }
            }
            break;
          }
          case 'voiceInit':
            report.voiceCodec = b.codec;
            report.voiceQuality = b.quality;
            break;
          case 'voiceData': {
            const p = player(b.slot);
            p.voicePackets++;
            p.voiceBytes += b.data.length;
            if (b.data.length === 0) {
              p.emptyVoicePackets++;
              break;
            }
            const prev = lastVoiceTime.get(b.slot);
            // A backwards clock (new section) also starts a new burst.
            if (prev === undefined || f.time - prev > BURST_GAP_SECONDS || f.time < prev) p.talkBursts++;
            lastVoiceTime.set(b.slot, f.time);
            break;
          }
          case 'user':
            if (b.name === 'TeamInfo' && b.payload.length >= 2) {
              // Payload: player entity number (1-based), then the team name.
              player(b.payload[0] - 1).team = asciiz(b.payload.subarray(1));
            }
            break;
        }
      }
    }
  }

  const playback = demo.sections.find((s) => s.entry?.description.toLowerCase() === 'playback');
  if (playback && playback.entry && playback.entry.trackTime > 0) {
    const secs = playback.entry.trackTime;
    report.measuredUpdatesPerSecond = Math.round((10 * playback.frames.filter((f) => f.type === FrameType.NetMessages).length) / secs) / 10;
    report.measuredFps = Math.round(playback.frames.filter((f) => f.type === FrameType.ClientData).length / secs);
  }
  if (state.hltv) report.recording = 'HLTV';
  if (report.recording === 'POV' && recorderSlot !== undefined) player(recorderSlot).isRecorder = true;
  if (report.voiceCodec === 'voice_miles') {
    for (const p of players.values()) p.voiceSeconds = (p.voiceBytes / MILES_FRAME_BYTES) * MILES_FRAME_SECONDS;
  }
  report.players = [...players.values()].filter((p) => p.name !== '' || p.voicePackets > 0).sort((a, b) => a.slot - b.slot);
  // The last map loaded in the loading section is the one playback starts on; earlier loads are dropped on conversion.
  const loadingLoads = mapLoads.filter((m) => m.section === 0);
  const startIdx = loadingLoads.length ? mapLoads.indexOf(loadingLoads[loadingLoads.length - 1]) : 0;
  report.loadingOnlyMaps = mapLoads.slice(0, startIdx).map((m) => m.name);
  for (const m of mapLoads.slice(startIdx)) if (report.maps[report.maps.length - 1] !== m.name) report.maps.push(m.name);
  if (report.maps.length === 0) report.maps.push(h.mapName.replace(/\.bsp$/i, ''));
  if (h.magic !== 'HLDEMO') problems.push(`This is not a GoldSrc demo (file starts with "${h.magic}").`);
  return report;
}
