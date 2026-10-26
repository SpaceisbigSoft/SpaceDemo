// The app's own settings, kept as one small JSON file in the app's data folder (on Windows %APPDATA%\SpaceDemo).
// Unknown or damaged content falls back to the defaults; the file is written to a temporary name first, then renamed,
// so a crash never leaves half a file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { THEME_CHOICES, type ThemeChoice } from '../shared/api.js';

export interface Settings {
  theme: ThemeChoice;
  /** Library folders (or single .dem / .zip files) the person added (plan 4.3). */
  libraryFolders: string[];
  /** Folders with old map versions (map pool). */
  mapFolders: string[];
}

// Dark by default: the approved look (owner, 2026-10-26).
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', libraryFolders: [], mapFolders: [] };

export function settingsFile(dataDir: string): string {
  return join(dataDir, 'settings.json');
}

function cleanPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const p of v) if (typeof p === 'string' && p.trim() && !out.includes(p)) out.push(p);
  return out;
}

/** Keeps only known keys with valid values; anything else becomes the default. */
export function cleanSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, libraryFolders: [], mapFolders: [] };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.theme === 'string' && (THEME_CHOICES as readonly string[]).includes(r.theme)) out.theme = r.theme as ThemeChoice;
    out.libraryFolders = cleanPaths(r.libraryFolders);
    out.mapFolders = cleanPaths(r.mapFolders);
  }
  return out;
}

export function loadSettings(file: string): Settings {
  try {
    return cleanSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return cleanSettings(undefined);
  }
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cleanSettings(settings), null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
