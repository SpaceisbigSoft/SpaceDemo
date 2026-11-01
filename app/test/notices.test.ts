// Plan 6.4: THIRD-PARTY-NOTICES.txt must match the shipped packages (package-lock.json) and licenses/.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

describe('third-party notices (6.4)', () => {
  it('is up to date (else: node tools/notices.mjs)', () => {
    expect(() => execFileSync(process.execPath, [join(root, 'tools/notices.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('names every shipped component and goes into the installer', () => {
    const notices = readFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    for (const name of ['Electron', 'Speex', 'Opus (libopus)', 'whisper.cpp', 'MinGW-w64', 'ONNX Runtime', 'DirectML', 'VoiceFixer', 'react-dom', 'opusscript', '@fontsource/inter']) {
      expect(notices).toContain(name);
    }
    expect(notices).toContain('CC BY 4.0');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const extra = (pkg.build.extraResources as { from: string; to: string }[]).map((r) => `${r.from}->${r.to}`);
    expect(extra).toContain('THIRD-PARTY-NOTICES.txt->THIRD-PARTY-NOTICES.txt');
    expect(notices).toContain(`SpaceDemo ${pkg.version}`);
  });
});
