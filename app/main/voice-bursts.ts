// 5.v Background-thread job: decode a demo's original voice into talk bursts and write each as a 16 kHz WAV file in a
// temporary folder of ours (the speech helper reads them). Miles voice (2002) uses our voice helper with the person's own
// mssvoice.asi (Windows only); Speex is decoded by the built-in decoder. The demo is only read.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAnyDemo } from '../../engine/src/container/read-any.js';
import { talkBursts } from '../../engine/src/voice/bursts.js';
import { helperDecoder, emulatorDecoder } from '../../engine/src/voice/decoders.js';
import { wav16k } from '../../engine/src/voice/transcribe.js';
import { readZipEntry } from '../../engine/src/zip.js';

export interface BurstsJob {
  file: string;
  zipEntry?: string;
  gameDir?: string;
  helperExe?: string;
  /** Our temporary folder for the WAV files. */
  outDir: string;
}

export interface BurstsResult {
  codec?: string;
  note?: string;
  error?: string;
  bursts: { file: string; player?: string; start: number; end: number }[];
}

export function writeBursts(job: BurstsJob): BurstsResult {
  try {
    const bytes = job.zipEntry ? readZipEntry(job.file, job.zipEntry) : new Uint8Array(readFileSync(job.file));
    const asi = job.gameDir ? join(job.gameDir, 'mssvoice.asi') : undefined;
    // Development on Linux: the Miles emulator (SPACEDEMO_MILES_EMULATOR=1, python3 + unicorn).
    const decoder = asi && existsSync(asi)
      ? process.platform === 'win32' && job.helperExe && existsSync(job.helperExe) ? helperDecoder(job.helperExe, asi)
        : process.env.SPACEDEMO_MILES_EMULATOR === '1' ? emulatorDecoder(asi) : undefined
      : undefined;
    const r = talkBursts(readAnyDemo(bytes).demo, decoder);
    mkdirSync(job.outDir, { recursive: true });
    const bursts = r.bursts.map((b, i) => {
      const file = join(job.outDir, `${String(i + 1).padStart(4, '0')}.wav`);
      writeFileSync(file, wav16k(b.pcm));
      return { file, player: b.player, start: b.start, end: b.end };
    });
    return { codec: r.codec, note: r.note, bursts };
  } catch (err) {
    return { error: (err as Error).message, bursts: [] };
  }
}
