// 5.v Voice to text in the app: the speech model (downloaded once into the app's data folder, or a model file the
// person already has) and transcribing one demo at a time in the background. The demo's voice is decoded in the
// background thread (talk bursts → WAV files in our own temporary folder), then our speech helper (whisper.cpp) turns
// them into text a few at a time. Transcripts are kept per demo, so a demo is only done once. Nothing leaves the PC
// except the one-time model download.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { FILES_PER_RUN, SPEECH_MODEL, transcribeFiles, transcriptPrompt, type WhisperRunner } from '../../engine/src/voice/transcribe.js';
import type { SpeechModelState, TranscriptLine, TranscriptState } from '../shared/api.js';
import type { LibraryService } from './library-service.js';
import type { LibraryReader } from './reader.js';

export interface SpeechDeps {
  dataDir: string;
  library: Pick<LibraryService, 'row'>;
  reader: Pick<LibraryReader, 'bursts'>;
  gameDir: () => string | undefined;
  voiceHelperExe: string;
  whisperExe: string;
  /** Run the speech helper under this (Linux development: "wine"). */
  wine?: string;
  /** Model chosen by hand (settings), and saving a new choice. */
  chosenModel: () => string | undefined;
  saveChosenModel: (path: string | undefined) => void;
  onModel: (s: SpeechModelState) => void;
  onTranscript: (s: TranscriptState) => void;
  /** Tests: download from here instead. */
  modelUrl?: string;
}

/** True if the file starts like a whisper.cpp (ggml) model. */
export function isSpeechModel(path: string): boolean {
  try {
    if (statSync(path).size < 1_000_000) return false;
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(4);
    readSync(fd, b, 0, 4, 0);
    closeSync(fd);
    return b.toString('latin1') === 'lmgg';
  } catch { return false; }
}

/**
 * How many speech helpers to run side by side, and threads each: about 3 threads per helper (Whisper's encoder uses
 * them well; its decoder mostly runs one step at a time), one core left free for Windows and SpaceDemo, and at most one
 * helper per ~1 GB of memory (the small model uses ~0.5 GB per helper).
 */
/**
 * Real (physical) CPU cores. Windows reports hyper-threads as extra processors (i9-14900K: 24 cores, 32 logical); two
 * threads sharing one core fight over the same units on this kind of maths, so the helpers are sized by real cores
 * (owner, 2026-10-31). Asked from Windows once; if that fails, half the logical count (at least 1).
 */
let coresCache: number | undefined;
export function physicalCores(): number {
  if (coresCache) return coresCache;
  const logical = cpus().length;
  let n: number | undefined;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      n = Number.parseInt(out.trim(), 10);
    } else if (process.platform === 'linux') {
      // Unique (physical id, core id) pairs.
      const pairs = new Set<string>();
      let phys = '0';
      for (const line of readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
        const m = /^(physical id|core id)\s*:\s*(\d+)/.exec(line);
        if (m?.[1] === 'physical id') phys = m[2];
        else if (m) pairs.add(`${phys}:${m[2]}`);
      }
      n = pairs.size || undefined;
    }
  } catch { /* fall back below */ }
  coresCache = n && n > 0 && n <= logical ? n : Math.max(1, Math.floor(logical / 2));
  return coresCache;
}

/** `cores` = real (physical) cores. */
export function parallelPlan(cores: number, memBytes: number): { processes: number; threads: number } {
  const usable = Math.max(1, cores - 1);
  const byMem = Math.max(1, Math.floor(memBytes / 1e9) - 2);
  const processes = Math.max(1, Math.min(Math.floor(usable / 3) || 1, byMem, 8));
  return { processes, threads: Math.max(1, Math.floor(usable / processes)) };
}

export class SpeechService {
  private downloading?: { done: number; total: number };
  private problem?: string;
  private working?: { key: string; state: TranscriptState; abort: AbortController };

  constructor(private readonly d: SpeechDeps) {}

  private defaultModel(): string { return join(this.d.dataDir, 'models', SPEECH_MODEL.file); }

  modelPath(): string | undefined {
    const chosen = this.d.chosenModel();
    if (chosen && existsSync(chosen)) return chosen;
    return existsSync(this.defaultModel()) ? this.defaultModel() : undefined;
  }

  model(): SpeechModelState {
    const chosen = this.d.chosenModel();
    return {
      path: this.modelPath(), chosenByHand: !!chosen && existsSync(chosen), helper: existsSync(this.d.whisperExe),
      size: SPEECH_MODEL.bytes, downloading: this.downloading, problem: this.problem,
    };
  }

  /** Uses a model file the person has (checked: a whisper.cpp model). */
  choose(path: string): SpeechModelState {
    if (!isSpeechModel(path)) { this.problem = `${basename(path)} is not a speech model file (whisper.cpp .bin).`; return this.model(); }
    this.problem = undefined;
    this.d.saveChosenModel(path);
    return this.model();
  }

  /** Downloads the model once (about 190 MB), checks it, then keeps it in the app's data folder. */
  async download(): Promise<SpeechModelState> {
    if (this.downloading) return this.model();
    const target = this.defaultModel();
    const part = `${target}.part`;
    mkdirSync(join(this.d.dataDir, 'models'), { recursive: true });
    this.problem = undefined;
    this.downloading = { done: 0, total: SPEECH_MODEL.bytes };
    this.d.onModel(this.model());
    try {
      const res = await fetch(this.d.modelUrl ?? SPEECH_MODEL.url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`);
      const total = Number(res.headers.get('content-length')) || SPEECH_MODEL.bytes;
      this.downloading = { done: 0, total };
      const hash = createHash('sha256');
      const out = createWriteStream(part);
      let lastSent = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        this.downloading.done += chunk.length;
        if (this.downloading.done - lastSent > total / 100) { lastSent = this.downloading.done; this.d.onModel(this.model()); }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      const sha = hash.digest('hex');
      if (!this.d.modelUrl && sha !== SPEECH_MODEL.sha256) throw new Error('the downloaded file is not the expected model (checksum differs)');
      renameSync(part, target);
      this.d.saveChosenModel(undefined);
    } catch (err) {
      try { rmSync(part, { force: true }); } catch { /* nothing to remove */ }
      this.problem = `Download failed: ${(err as Error).message}. Try again, or choose a model file you have.`;
    }
    this.downloading = undefined;
    const s = this.model();
    this.d.onModel(s);
    return s;
  }

  private cacheFile(key: string): string {
    return join(this.d.dataDir, 'transcripts', `${createHash('sha1').update(key).digest('hex')}.json`);
  }

  transcript(key: string): TranscriptState {
    if (this.working?.key === key) return { ...this.working.state };
    try {
      const s = JSON.parse(readFileSync(this.cacheFile(key), 'utf8')) as TranscriptState;
      if (s.key === key && s.status === 'done') return s;
    } catch { /* not made yet */ }
    return { key, status: 'none' };
  }

  stop(): void { this.working?.abort.abort(); }

  /** Starts turning one demo's voice into text (one demo at a time). */
  start(key: string): TranscriptState {
    if (this.working) {
      return this.working.key === key ? { ...this.working.state } : { key, status: 'failed', error: 'Another demo is being turned into text; wait for it or stop it first.' };
    }
    const model = this.modelPath();
    const row = this.d.library.row(key);
    if (!row) return { key, status: 'failed', error: 'This demo is no longer in the library.' };
    if (!model) return { key, status: 'failed', error: 'The speech model is not there yet: download it in Settings → Voice to text.' };
    if (!existsSync(this.d.whisperExe)) return { key, status: 'failed', error: 'The speech helper is missing (helpers\\whisper-helper\\spacedemo-whisper.exe).' };
    const state: TranscriptState = { key, status: 'working', done: 0 };
    const abort = new AbortController();
    this.working = { key, state, abort };
    void this.run(key, row.candidate.file, row.candidate.zipEntry, model, state, abort.signal);
    return { ...state };
  }

  private async run(key: string, file: string, zipEntry: string | undefined, model: string, state: TranscriptState, signal: AbortSignal): Promise<void> {
    const tmp = join(tmpdir(), 'spacedemo-voice', createHash('sha1').update(key).digest('hex').slice(0, 12));
    const send = () => this.d.onTranscript({ ...state });
    try {
      rmSync(tmp, { recursive: true, force: true });
      const b = await this.d.reader.bursts({ file, zipEntry, gameDir: this.d.gameDir(), helperExe: this.d.voiceHelperExe, outDir: tmp });
      if (b.error) throw new Error(b.error);
      if (!b.bursts.length) { Object.assign(state, { status: 'done', lines: [], note: b.note ?? 'No talking in this demo.', model: basename(model), madeAt: Date.now() }); this.save(key, state); return; }
      state.total = b.bursts.length;
      send();
      // Several helpers side by side (each on its own few files): one helper can't keep a big CPU busy on short clips,
      // because much of Whisper's work per clip runs one step after another.
      const plan = parallelPlan(physicalCores(), totalmem());
      const runner: WhisperRunner = { exe: this.d.whisperExe, wine: this.d.wine, model, threads: plan.threads };
      const prompt = transcriptPrompt(b.bursts.map((x) => x.player ?? ''));
      const lines: TranscriptLine[] = [];
      const batches: (typeof b.bursts)[] = [];
      for (let i = 0; i < b.bursts.length; i += FILES_PER_RUN) batches.push(b.bursts.slice(i, i + FILES_PER_RUN));
      let next = 0, done = 0;
      const worker = async () => {
        while (next < batches.length) {
          if (signal.aborted) throw new Error('Stopped.');
          const part = batches[next++];
          const texts = await transcribeFiles(runner, part.map((x) => x.file), prompt, signal);
          for (const x of part) {
            const text = texts.get(x.file);
            if (text) lines.push({ time: x.start, end: x.end, player: x.player, text });
          }
          done += part.length;
          state.done = done;
          state.lines = [...lines].sort((p, q) => p.time - q.time);
          send();
        }
      };
      await Promise.all(Array.from({ length: Math.min(plan.processes, batches.length) }, worker));
      lines.sort((p, q) => p.time - q.time);
      Object.assign(state, { status: 'done', lines, model: basename(model), madeAt: Date.now() });
      this.save(key, state);
    } catch (err) {
      Object.assign(state, { status: 'failed', error: (err as Error).message });
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* our own temporary files */ }
      this.working = undefined;
      send();
    }
  }

  private save(key: string, s: TranscriptState): void {
    const f = this.cacheFile(key);
    mkdirSync(join(this.d.dataDir, 'transcripts'), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify({ ...s, key }));
    renameSync(`${f}.tmp`, f);
  }
}
