// 5.v voice to text in the app: model file check, choosing a model, and a whole demo turned into text in the background
// (Speex demo in CDF_SPEEX_DEMO; the speech helper is a stand-in script that writes made-up text), then kept.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { directReader } from '../main/reader.js';
import { isSpeechModel, parallelPlan, physicalCores, SpeechService } from '../main/speech-service.js';
import type { TranscriptState } from '../shared/api.js';

const fakeModel = (dir: string) => { const f = join(dir, 'model.bin'); const b = Buffer.alloc(2_000_000); b.write('lmgg', 0, 'latin1'); writeFileSync(f, b); return f; };

describe('5.v speech service', () => {
  it('runs several helpers side by side on bigger CPUs, within memory', () => {
    expect(parallelPlan(2, 8e9)).toEqual({ processes: 1, threads: 1 });
    expect(parallelPlan(8, 16e9)).toEqual({ processes: 2, threads: 3 });
    expect(parallelPlan(16, 32e9)).toEqual({ processes: 5, threads: 3 });
    expect(parallelPlan(24, 32e9)).toEqual({ processes: 7, threads: 3 });
    expect(parallelPlan(32, 4e9)).toEqual({ processes: 2, threads: 15 });
    // The owner's i9-14900K: 24 real cores (32 logical), 48 GB → 7 helpers × 3 threads = 21 threads on real cores.
    expect(parallelPlan(24, 48e9)).toEqual({ processes: 7, threads: 3 });
    expect(physicalCores()).toBeGreaterThanOrEqual(1);
  });
  it('recognises a whisper.cpp model file and refuses others', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-sp-'));
    try {
      expect(isSpeechModel(fakeModel(dir))).toBe(true);
      writeFileSync(join(dir, 'x.bin'), Buffer.alloc(2_000_000));
      expect(isSpeechModel(join(dir, 'x.bin'))).toBe(false);
      let chosen: string | undefined;
      const s = new SpeechService({ dataDir: dir, library: { row: () => undefined }, reader: directReader(), gameDir: () => undefined, voiceHelperExe: '', whisperExe: join(dir, 'none.exe'),
        chosenModel: () => chosen, saveChosenModel: (p) => { chosen = p; }, onModel: () => {}, onTranscript: () => {} });
      expect(s.model().path).toBeUndefined();
      expect(s.choose(join(dir, 'x.bin')).problem).toContain('not a speech model');
      expect(s.choose(join(dir, 'model.bin')).path).toBe(join(dir, 'model.bin'));
      expect(s.start('k')).toMatchObject({ status: 'failed' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  const demo = process.env.CDF_SPEEX_DEMO;
  it.skipIf(!demo)('turns a Speex demo into text in the background and keeps it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-sp-'));
    try {
      const model = fakeModel(dir);
      const updates: TranscriptState[] = [];
      const s = new SpeechService({
        dataDir: dir, library: { row: () => ({ demo: {} as never, candidate: { file: demo!, key: 'k', name: 'fta', size: 0, mtime: 0 } as never }) }, reader: directReader(),
        gameDir: () => undefined, voiceHelperExe: '', whisperExe: join(__dirname, 'fake-whisper.mjs'),
        chosenModel: () => model, saveChosenModel: () => {}, onModel: () => {}, onTranscript: (x) => updates.push(x),
      });
      expect(s.start('k').status).toBe('working');
      expect(s.start('other').error).toContain('Another demo');
      await new Promise<void>((resolve) => { const t = setInterval(() => { if (updates.at(-1)?.status === 'done' || updates.at(-1)?.status === 'failed') { clearInterval(t); resolve(); } }, 200); });
      const done = updates.at(-1)!;
      expect(done.error).toBeUndefined();
      expect(done.status).toBe('done');
      expect(done.lines!.length).toBe(done.total);
      expect(done.lines![0].text).toBe('rush B number 0001');
      expect(done.lines![0].player).toBeTruthy();
      expect(updates.some((u) => u.status === 'working' && (u.done ?? 0) > 0 && (u.done ?? 0) < (u.total ?? 0))).toBe(true);
      // Kept: asking again gives the same lines without working.
      expect(s.transcript('k').lines!.length).toBe(done.lines!.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 300_000);
});
