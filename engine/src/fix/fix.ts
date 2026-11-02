// One step from an old demo to one that plays in today's CS 1.6 with its original voice (plans 2.6, 2.7, 2.8):
// recover a crashed recording, convert to protocol 48 (dropping sprites/models today's game doesn't have), and put the
// old voice back as Steam voice. The original file is never changed; the caller writes the result to a new file.
import { speexDecoder } from '../voice/speex.js';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DemoFile } from '../container/types.js';
import { readDemo } from '../container/read.js';
import { writeDemo } from '../container/write.js';
import { upgradeTo48 } from '../transforms/upgrade-to-48.js';
import { burstAudio, oldVoicePackets, restoreVoice, talkBursts, type OldVoicePacket, type PcmFilter, type RestoreOptions, type RestoreReport } from '../voice/restore.js';
import { AI_DEFAULT_RATE, AI_STYLE, enhanceBursts, type VoiceEnhancer } from '../voice/enhance.js';
import { evenLevel } from '../voice/cleanup.js';
import type { OldVoiceDecoder } from '../voice/decoders.js';
import { createState, decodeMessages } from '../protocol/messages.js';
import { FrameType } from '../container/types.js';
import { isFormat4, readHeader4 } from '../legacy/format4.js';
import { convert1999 } from '../legacy/convert-1999.js';
import { readSentenceLists } from '../legacy/sentences.js';

/** Sprites and models of CS 1.0–1.5 that build 10210 doesn't have (Reference: the CS 1.5 scope overlay). */
export const MISSING_IN_BUILD_10210 = [
  'top', 'top2', 'top3', 'top_left', 'top_left2', 'top_left3', 'top_right', 'top_right2', 'top_right3', 'bottom', 'bottom2', 'bottom3',
  'bottom_left', 'bottom_left2', 'bottom_left3', 'bottom_right', 'bottom_right2', 'bottom_right3', 'left3', 'right', 'right2', 'right3', 'horizontal', 'vertical',
].map((n) => `sprites/${n}.spr`);

/**
 * "Is this resource missing from the player's game?" Checks sprites and models in the game folder's cstrike and valve
 * directories (case-insensitive, like Windows). Sounds and maps are never reported missing (maps come from our own
 * old-map folder; sounds are harmless).
 */
export function gameResourceCheck(halfLifeDir?: string): (name: string) => boolean {
  const known = new Set(MISSING_IN_BUILD_10210);
  if (!halfLifeDir) return (name) => known.has(name.toLowerCase().replace(/\\/g, '/'));
  const index = new Set<string>();
  for (const mod of ['cstrike', 'valve', 'cstrike_downloads']) {
    for (const sub of ['sprites', 'models']) {
      const root = join(halfLifeDir, mod, sub);
      if (!existsSync(root)) continue;
      const walk = (dir: string, rel: string) => {
        for (const e of readdirSync(dir)) {
          const p = join(dir, e), r = `${rel}/${e}`.toLowerCase();
          if (statSync(p).isDirectory()) walk(p, r); else index.add(r);
        }
      };
      walk(root, sub);
    }
  }
  return (name) => {
    const n = name.toLowerCase().replace(/\\/g, '/');
    if (!/\.(spr|mdl)$/.test(n)) return false;
    return !index.has(n);
  };
}

export interface FixOptions {
  /** Half-Life folder of the player's game (to check which sprites/models exist). */
  halfLifeDir?: string;
  /** 0.8: play on a copy of the demo's old map saved under this name (see UpgradeOptions.mapName). */
  mapName?: string;
  /** Decoder for old voice; without one, voice is left as it is (it will not play in today's game). */
  voiceDecoder?: OldVoiceDecoder;
  /** Optional processing of decoded voice (the "voice cleanup" setting). */
  voiceFilter?: PcmFilter;
}

export interface FixReport {
  recovered: boolean;
  problems: string[];
  sourceProtocol: number;
  converted: boolean;
  conversion: Record<string, number>;
  notes: string[];
  voiceCodec?: string;
  voice?: RestoreReport & { decoder: string };
  /** AI voice enhancement (5.g4): model id, encode rate, time taken (s). */
  ai?: { model: string; rate: number; seconds: number; style: number };
}

/** The voice codec a demo announces (svc_voiceinit), e.g. "voice_miles", "voice_speex", "" (Steam voice). */
export function voiceCodecOf(demo: DemoFile): string | undefined {
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  for (const sec of demo.sections) for (const f of sec.frames) {
    if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
    for (const m of decodeMessages(f.messages, s)) if (m.body?.kind === 'voiceInit') return m.body.codec;
  }
  return undefined;
}

/** The voice quality a demo announces (svc_voiceinit, protocol 47+), if any. */
export function voiceQualityOf(demo: DemoFile): number | undefined {
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  for (const sec of demo.sections) for (const f of sec.frames) {
    if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
    for (const m of decodeMessages(f.messages, s)) if (m.body?.kind === 'voiceInit') return m.body.quality;
  }
  return undefined;
}

interface Prepared {
  cur: DemoFile;
  report: FixReport;
  /** Decoded old voice, ready to put back (undefined = nothing to restore). */
  voice?: { packets: OldVoicePacket[]; pcm: Int16Array[]; decoder: string };
}

/** Repair + convert + decode the old voice (everything before the voice is put back). */
function prepare(input: Uint8Array, options: FixOptions): Prepared {
  if (isFormat4(input)) {
    // 1999 demos (plan F4): their own converter; no voice existed then.
    const h = readHeader4(input);
    const up = convert1999(input, { isResourceMissing: gameResourceCheck(options.halfLifeDir), mapName: options.mapName, sentences: options.halfLifeDir ? readSentenceLists(options.halfLifeDir) : undefined });
    const report: FixReport = { recovered: false, problems: [], sourceProtocol: h.networkProtocol, converted: true, conversion: up.report.applied, notes: [...up.report.warnings, 'This demo has no voice recorded in it.'] };
    return { cur: up.demo, report };
  }
  const demo = readDemo(input);
  const report: FixReport = { recovered: !!demo.recovered, problems: [...demo.problems], sourceProtocol: demo.header.networkProtocol, converted: false, conversion: {}, notes: [] };
  report.voiceCodec = voiceCodecOf(demo);
  let cur = demo;
  if (cur.header.networkProtocol !== 48) {
    const up = upgradeTo48(cur, { isResourceMissing: gameResourceCheck(options.halfLifeDir), mapName: options.mapName });
    cur = up.demo;
    report.converted = true;
    report.conversion = up.report.applied;
    report.notes.push(...up.report.warnings);
  }
  if (options.mapName && !report.converted) report.notes.push(`This demo already uses protocol 48; playing it on a renamed old map (${options.mapName}) isn't supported yet.`);
  const packets = oldVoicePackets(cur);
  const old = report.voiceCodec && report.voiceCodec !== '' && packets.some((p) => p.data.length > 0);
  if (old && report.voiceCodec === 'voice_miles') {
    if (!options.voiceDecoder) report.notes.push('Old Miles voice left as is (no voice decoder given): it will not be heard in today\'s game.');
    else return { cur, report, voice: { packets, pcm: options.voiceDecoder.decodeAll(packets), decoder: options.voiceDecoder.name } };
  } else if (old && report.voiceCodec === 'voice_speex') {
    // 2.17: Speex is decoded by our built-in decoder (no game file needed).
    const dec = speexDecoder(voiceQualityOf(demo) ?? 5);
    const pcm = dec.decodeAll(packets);
    if (dec.stats.corrupt) report.notes.push(`${dec.stats.corrupt} of ${dec.stats.frames} Speex voice frames were damaged and were filled in.`);
    return { cur, report, voice: { packets, pcm, decoder: dec.name } };
  } else if (!packets.some((p) => p.data.length > 0)) {
    report.notes.push('This demo has no voice recorded in it.');
  } else if (old) {
    report.notes.push(`Voice codec "${report.voiceCodec}" is not supported yet (only voice_miles and voice_speex); voice left as is.`);
  }
  return { cur, report };
}

function finish(p: Prepared, restore?: RestoreOptions): { bytes: Uint8Array; report: FixReport } {
  let cur = p.cur;
  if (p.voice) {
    const r = restoreVoice(cur, p.voice.pcm, restore);
    cur = r.demo;
    p.report.voice = { ...r.report, decoder: p.voice.decoder };
  }
  return { bytes: writeDemo(cur, { rebuildDirectory: true }), report: p.report };
}

export function fixDemo(input: Uint8Array, options: FixOptions = {}): { bytes: Uint8Array; report: FixReport } {
  return finish(prepare(input, options), { filter: options.voiceFilter });
}

export interface AiOptions {
  enhancer: VoiceEnhancer;
  /** Steam voice encode rate for the enhanced voice (default 24000: owner preferred it in game on all 3 test demos, 5.g6). */
  rate?: 8000 | 24000;
  cacheDir?: string;
  onProgress?: (done: number, total: number) => void;
}

/** fixDemo, optionally with AI voice enhancement (5.g4). Without `ai` it is the same as fixDemo. */
export async function fixDemoAsync(input: Uint8Array, options: FixOptions & { ai?: AiOptions } = {}): Promise<{ bytes: Uint8Array; report: FixReport }> {
  const p = prepare(input, options);
  if (!options.ai || !p.voice) return finish(p, { filter: options.voiceFilter });
  const t0 = Date.now();
  const bursts = talkBursts(p.voice.packets, p.voice.pcm);
  const audio = bursts.map((b) => burstAudio(b, p.voice!.pcm));
  const slots = bursts.map((b) => p.voice!.packets[b[0]].slot);
  const rate = options.ai.rate ?? AI_DEFAULT_RATE;
  // The cache holds the model's output; the level step (same as voice cleanup's) runs after it (5.g6).
  const replacement = (await enhanceBursts(audio, slots, options.ai.enhancer, { rate, cacheDir: options.ai.cacheDir, onProgress: options.ai.onProgress }))
    .map((b) => evenLevel(b, rate));
  const out = finish(p, { replacement, rate });
  out.report.ai = { model: options.ai.enhancer.id, rate, seconds: Math.round((Date.now() - t0) / 100) / 10, style: AI_STYLE };
  return out;
}
