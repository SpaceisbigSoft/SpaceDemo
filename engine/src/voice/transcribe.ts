// 5.v Voice to text with whisper.cpp (OpenAI Whisper, MIT): our Windows helper (helpers/whisper-helper, built from
// whisper.cpp's command-line program) and the speech model the user downloads (ggml-small.en-q5_1.bin, chosen in the
// 5.v trial: Logs\CS Demo Fixer Spike 6). Each talk burst is a 16 kHz WAV file; the helper is run on a few files at a
// time (it loads the model once per run) and writes a .json next to each file. Runs in the background, nothing is sent
// anywhere.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** The model the app downloads (trial winner) and where it comes from. */
export const SPEECH_MODEL = {
  file: 'ggml-small.en-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin',
  bytes: 190098681,
  /** SHA-256 of the owner's download from that address (2026-10-31). */
  sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
};

/** Files per helper run: the model loads once per run (~1 s), and progress is reported between runs. */
export const FILES_PER_RUN = 8;

/** 8 kHz mono PCM → a 16 kHz mono 16-bit WAV file (Whisper reads only 16 kHz), with half a second of silence after. */
export function wav16k(pcm8k: Int16Array): Uint8Array {
  const n = pcm8k.length * 2 + 8000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < pcm8k.length; i++) {
    const a = pcm8k[i], c = i + 1 < pcm8k.length ? pcm8k[i + 1] : a;
    b.writeInt16LE(a, 44 + i * 4);
    b.writeInt16LE((a + c) >> 1, 46 + i * 4);
  }
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

/** The word list given to the model: Counter-Strike callouts and the players' names (without clan tags). */
export function transcriptPrompt(players: string[]): string {
  // Clan tags (":i69:", ".MoD", "fta.") = short parts shared by two or more names; the rest is the name.
  const parts = players.map((p) => p.split(/[^A-Za-z0-9]+/).filter(Boolean));
  const count = new Map<string, number>();
  for (const ps of parts) for (const t of new Set(ps)) count.set(t, (count.get(t) ?? 0) + 1);
  const names = [...new Set(parts.map((ps) => ps.filter((t) => !(t.length <= 6 && (count.get(t) ?? 0) >= 2)).join(' ')).filter((n) => n.length >= 2))];
  return 'Counter-Strike team voice chat. Callouts: bomb, plant, defuse, site A, site B, mid, ramp, CT spawn, T spawn, rush, rotate, '
    + `flash, smoke, nade, AWP, AK, deagle, one left, two left, he's low, hit, lit, hurt.${names.length ? ` Players: ${names.join(', ')}.` : ''}`;
}

/** The model's text without its markers for silence or noise ("[BLANK_AUDIO]", "(laughs)", "!!!"). */
export function cleanText(text: string): string {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  return /[A-Za-z0-9]/.test(t) ? t : '';
}

export interface WhisperRunner {
  /** The helper (spacedemo-whisper.exe); on Linux it runs under `wine` when given. */
  exe: string;
  wine?: string;
  model: string;
  threads?: number;
}

/** Runs the helper on some WAV files; resolves with the text of each (by file). */
export function transcribeFiles(r: WhisperRunner, files: string[], prompt: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const winPath = (p: string) => (r.wine && p.startsWith('/') ? `Z:${p.replace(/\//g, '\\')}` : p);
  const args = ['-m', winPath(r.model), '-l', 'en', '-t', String(r.threads ?? 4), '-nt', '-oj', '--prompt', prompt, ...files.flatMap((f) => ['-f', winPath(f)])];
  const [cmd, cmdArgs] = r.wine ? [r.wine, [r.exe, ...args]] : [r.exe, args];
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: r.wine ? { ...process.env, WINEDEBUG: '-all' } : process.env });
    let err = '';
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    const onAbort = () => p.kill();
    signal?.addEventListener('abort', onAbort);
    p.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(new Error(`The speech helper could not start: ${e.message}`)); });
    p.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Stopped.'));
      const out = new Map<string, string>();
      for (const f of files) {
        const j = `${f}.json`;
        if (!existsSync(j)) continue;
        try {
          const data = JSON.parse(readFileSync(j, 'utf8')) as { transcription?: { text: string }[] };
          out.set(f, cleanText((data.transcription ?? []).map((s) => s.text).join(' ')));
        } catch { /* unreadable: no text */ }
      }
      if (code !== 0 && out.size === 0) reject(new Error(`The speech helper stopped (code ${code}): ${err.split('\n').filter(Boolean).slice(-2).join(' ')}`));
      else resolve(out);
    });
  });
}
