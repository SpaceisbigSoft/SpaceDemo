// 6.5: when the AI voice can't start, the demo is still fixed (normal voice) with a plain note.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureDemos } from '../../engine/test/fixtures.js';
import { aiStartProblem, runFix, VC_REDIST_URL } from '../main/fixer.js';

describe('AI voice that cannot start (6.5)', () => {
  it('names the Visual C++ runtime when a DLL is missing', () => {
    const e = new Error('The specified module could not be found.\r\n\\\\?\\C:\\SpaceDemo\\resources\\app.asar.unpacked\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime_binding.node');
    expect(aiStartProblem(e)).toContain('Microsoft Visual C++ Redistributable (x64)');
    expect(aiStartProblem(e)).toContain(VC_REDIST_URL);
    expect(aiStartProblem(new Error('model file is damaged'))).toBe("The AI voice couldn't start (model file is damaged). This copy has the normal voice.");
  });

  const demo = fixtureDemos()[0];
  it.skipIf(!demo)('still fixes the demo with the normal voice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-ai-'));
    const badModel = join(dir, 'not-a-model.onnx');
    writeFileSync(badModel, 'not an onnx model');
    const r = await runFix({ file: demo!, output: join(dir, 'fixed.dem'), overwrite: false, cleanup: true, ai: { model: badModel, threads: 1, cacheDir: dir } });
    expect(r.ok).toBe(true);
    expect(r.ai).toBe(false);
    expect(r.notes[0]).toMatch(/^The AI voice couldn't start/);
  }, 120_000);
});
