// The app's own settings, kept as one small JSON file in the app's data folder (on Windows %APPDATA%\SpaceDemo).
// Unknown or damaged content falls back to the defaults; the file is written to a temporary name first, then renamed,
// so a crash never leaves half a file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { THEME_CHOICES, type ThemeChoice } from '../shared/api.js';

export interface Settings {
  theme: ThemeChoice;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system' };

export function settingsFile(dataDir: string): string {
  return join(dataDir, 'settings.json');
}

/** Keeps only known keys with valid values; anything else becomes the default. */
export function cleanSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const theme = (raw as Record<string, unknown>).theme;
    if (typeof theme === 'string' && (THEME_CHOICES as readonly string[]).includes(theme)) out.theme = theme as ThemeChoice;
  }
  return out;
}

export function loadSettings(file: string): Settings {
  try {
    return cleanSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cleanSettings(settings), null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
