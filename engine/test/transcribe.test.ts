// 5.v voice to text: WAV conversion, word list, cleaning the model's markers (no files needed); with CDF_WHISPER_EXE
// (our helper), CDF_WHISPER_MODEL (ggml model) and CDF_SPEEX_DEMO (a Speex-voice demo), a few real talk bursts are turned
// into text (on Linux the helper runs under wine).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { talkBursts } from '../src/voice/bursts.js';
import { cleanText, transcribeFiles, transcriptPrompt, wav16k } from '../src/voice/transcribe.js';

describe('5.v voice to text helpers', () => {
  it('makes 16 kHz WAV files with half a second of silence after', () => {
    const w = wav16k(new Int16Array([0, 100, 200]));
    const v = new DataView(w.buffer, w.byteOffset, w.byteLength);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe((6 + 8000) * 2);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 50, 100, 150]);
  });
  it('gives the model callouts and the names without clan tags', () => {
    const p = transcriptPrompt([':i69:Endbringer', ':i69:Guido', 'Tang.MoD', 'Tyr.MoD', 'fta.gx', 'fta.hyeng']);
    expect(p).toContain('Players: Endbringer, Guido, Tang, Tyr, gx, hyeng.');
    expect(p).toContain('site B');
  });
  it('drops the model\'s markers for silence and noise', () => {
    expect(cleanText(' [BLANK_AUDIO]')).toBe('');
    expect(cleanText('(L)')).toBe('');
    expect(cleanText('!!!')).toBe('');
    expect(cleanText(' Long, long, long. (laughs)')).toBe('Long, long, long.');
  });
});

const exe = process.env.CDF_WHISPER_EXE, model = process.env.CDF_WHISPER_MODEL, demo = process.env.CDF_SPEEX_DEMO;
describe.skipIf(!exe || !model || !demo)('5.v on a real Speex demo (helper + model)', () => {
  it('turns the first 3 talk bursts into text', async () => {
    const r = talkBursts(readDemo(new Uint8Array(readFileSync(demo!))));
    expect(r.codec).toBe('voice_speex');
    expect(r.bursts.length).toBeGreaterThan(100);
    const dir = mkdtempSync(join(tmpdir(), 'sd-asr-'));
    try {
      const files = r.bursts.slice(0, 3).map((b, i) => { const f = join(dir, `${i}.wav`); writeFileSync(f, wav16k(b.pcm)); return f; });
      const texts = await transcribeFiles({ exe: exe!, model: model!, threads: 2, wine: process.platform === 'win32' ? undefined : 'wine' }, files, transcriptPrompt(r.bursts.map((b) => b.player ?? '')));
      expect(texts.size).toBe(3);
      expect([...texts.values()].filter((t) => t.length > 0).length).toBeGreaterThanOrEqual(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 600_000);
});
