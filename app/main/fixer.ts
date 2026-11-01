// Fixing a demo from the app (plans 4.5/4.6): the same one-step fix as `npm run fix` (repair, convert to protocol 48,
// original voice back as Steam voice with voice cleanup on). Runs in the background thread. The original (a .dem, or the
// .zip that holds it) is only read; the fixed copy is a new file written through writeNewFile().
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fixDemoAsync } from '../../engine/src/fix/fix.js';
import { onnxEnhancer, type VoiceEnhancer } from '../../engine/src/voice/enhance.js';
import { writeNewFile } from '../../engine/src/fix/safe-output.js';
import { voiceCleanup } from '../../engine/src/voice/cleanup.js';
import { helperDecoder } from '../../engine/src/voice/decoders.js';
import { readZipEntry } from '../../engine/src/zip.js';
import { demoMapOf, installOldMap, planOldMap } from '../../engine/src/launch/old-maps.js';

export interface FixJob {
  /** The .dem, or the .zip holding it. */
  file: string;
  zipEntry?: string;
  output: string;
  /** Allowed only when the output is our own earlier fixed copy of this demo. */
  overwrite: boolean;
  /** Half-Life folder of today's game (sprite/model check, and its mssvoice.asi for the old voice). */
  gameDir?: string;
  /** Our voice helper (helpers/voice-helper/cdf-voice-helper.exe). */
  helperExe?: string;
  /** Voice cleanup (owner's default: on). */
  cleanup: boolean;
  /** 5.g5 AI voice enhancement: the model file, cores to use, and the folder for finished results. */
  ai?: { model: string; threads: number; cacheDir: string };
  /** 0.8: folders with old map versions (Settings → Old map versions). */
  mapFolders?: string[];
}

export interface FixResult {
  ok: boolean;
  output?: string;
  error?: string;
  seconds?: number;
  /** What was done, in plain words. */
  done: string[];
  /** Things to know (e.g. voice left as is). */
  notes: string[];
  /** Original voice put back (seconds and talk bursts), when there was some. */
  voice?: { seconds: number; bursts: number };
  /** The voice was AI-enhanced (5.g5). */
  ai?: boolean;
  /** Version of the AI voice (5.g6, AI_STYLE). */
  aiStyle?: number;
  /** 0.8: the old map put in cstrike_downloads\maps for this demo (so Watch can put it back if it was deleted). */
  oldMap?: { source: string; installName: string };
}

// The model is loaded once per thread and kept (about 1 s and a few hundred MB), as long as the file and cores stay the same.
let loaded: { key: string; enhancer: Promise<VoiceEnhancer> } | undefined;
function enhancerFor(model: string, threads: number): Promise<VoiceEnhancer> {
  const key = `${model}|${threads}`;
  if (loaded?.key !== key) {
    void loaded?.enhancer.then((e) => e.close?.()).catch(() => undefined);
    loaded = { key, enhancer: onnxEnhancer(model, { threads }) };
    loaded.enhancer.catch(() => { loaded = undefined; });
  }
  return loaded.enhancer;
}

/** `onProgress`: seconds of voice done / total while the AI works. */
export async function runFix(job: FixJob, onProgress?: (p: { done: number; total: number }) => void): Promise<FixResult> {
  const t0 = Date.now();
  try {
    const input = job.zipEntry ? readZipEntry(job.file, job.zipEntry) : new Uint8Array(readFileSync(job.file));
    const asi = job.gameDir ? join(job.gameDir, 'mssvoice.asi') : undefined;
    // The helper is a Windows program; it loads the person's own mssvoice.asi (never bundled).
    const decoder = process.platform === 'win32' && asi && existsSync(asi) && job.helperExe && existsSync(job.helperExe)
      ? helperDecoder(job.helperExe, asi)
      : undefined;
    const ai = job.ai ? { enhancer: await enhancerFor(job.ai.model, job.ai.threads), cacheDir: job.ai.cacheDir, onProgress: (done: number, total: number) => onProgress?.({ done, total }) } : undefined;
    // 0.8: the demo's old map version goes into cstrike_downloads\maps (under a new name when today's map has its name).
    const mapDone: string[] = [], mapNotes: string[] = [];
    let mapName: string | undefined, oldMap: FixResult['oldMap'];
    if (job.gameDir) {
      const dm = demoMapOf(input);
      const plan = planOldMap(dm.name, dm.checksum, job.gameDir, job.mapFolders ?? []);
      if (plan.kind === 'install') {
        try {
          const r = installOldMap(job.gameDir, plan);
          mapDone.push(...r.done);
          mapNotes.push(...r.notes);
          if (plan.rename) mapName = plan.installName;
          oldMap = { source: plan.source, installName: plan.installName };
        } catch (e) {
          mapNotes.push(`The old map couldn't be put in place: ${(e as Error).message}`);
        }
      } else if (plan.kind === 'missing') {
        mapNotes.push(plan.otherVersion
          ? `This demo was recorded on an older version of ${plan.name} that wasn't found, so the game will likely stop when it loads the map. Add a folder with old maps in Settings → Old map versions.`
          : `The map ${plan.name} wasn't found, so the game will likely stop when it loads the map. Add a folder with it in Settings → Old map versions.`);
      }
    }
    const { bytes, report } = await fixDemoAsync(input, { halfLifeDir: job.gameDir, mapName, voiceDecoder: decoder, voiceFilter: job.cleanup && !ai ? voiceCleanup : undefined, ai });
    mkdirSync(dirname(job.output), { recursive: true });
    writeNewFile([job.file], job.output, bytes, { overwrite: job.overwrite });
    const done: string[] = [];
    if (report.recovered) done.push('Repaired a cut-off recording.');
    if (report.converted) done.push(`Converted protocol ${report.sourceProtocol} → 48 for today's CS 1.6.`);
    if (report.voice) done.push(`Put the original voice back as Steam voice (${Math.round(report.voice.seconds / 6) / 10} min${report.ai ? ', AI-enhanced' : job.cleanup ? ', voice cleanup on' : ''}).`);
    done.push(...mapDone);
    const voice = report.voice ? { seconds: report.voice.seconds, bursts: report.voice.bursts } : undefined;
    return { ok: true, output: job.output, seconds: (Date.now() - t0) / 1000, done, notes: [...report.notes, ...mapNotes], voice, ai: !!report.ai, aiStyle: report.ai?.style, oldMap };
  } catch (err) {
    return { ok: false, error: (err as Error).message, done: [], notes: [] };
  }
}
