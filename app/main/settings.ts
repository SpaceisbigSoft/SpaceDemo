// The app's own settings, kept as one small JSON file in the app's data folder (on Windows %APPDATA%\SpaceDemo).
// Unknown or damaged content falls back to the defaults; the file is written to a temporary name first, then renamed,
// so a crash never leaves half a file.
import { cleanSavedWindow, type SavedWindow } from './window-state.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { THEME_CHOICES, type ThemeChoice } from '../shared/api.js';

export interface Settings {
  theme: ThemeChoice;
  /** Library folders (or single .dem / .zip files) the person added (plan 4.3). */
  libraryFolders: string[];
  /** Folders with old map versions (map pool). */
  mapFolders: string[];
  /** Where fixed copies go; undefined = Documents\SpaceDemo\Fixed demos. */
  outputFolder?: string;
  /** Half-Life folder chosen by hand (plan 4.7); undefined = found automatically. */
  gameDir?: string;
  /** Voice cleanup when fixing (owner's default: on). */
  voiceCleanup: boolean;
  /** 5.p: player names merged by the owner (alias → the name it belongs to). */
  playerMerges: Record<string, string>;
  /** 5.p: suggested merges the owner said no to ("a|b", sorted). */
  playerRejected: string[];
  /** 5.v: speech model file chosen by hand (undefined = the downloaded one in the app's data folder). */
  speechModel?: string;
  /** Processor cores SpaceDemo may use for heavy work (voice to text, AI voice); undefined = the suggested maximum
   * (real cores − 1, owner 2026-11-01). */
  cpuCores?: number;
  /** 5.g5 AI voice enhancement when fixing (off by default; the plain fix stays the default). */
  aiVoice: boolean;
  /** 4.10: a demo's own choice (library key → AI voice on/off) where it differs from `aiVoice`; never changes `aiVoice`. */
  aiVoiceDemos: Record<string, boolean>;
  /** 5.g5 AI model file chosen by hand (undefined = the downloaded one in the app's data folder). */
  aiModel?: string;
  /** 6.7: check GitHub for a newer version when SpaceDemo starts (on by default). */
  updateCheck: boolean;
  /** Window size/place when SpaceDemo last closed (owner, 2026-11-01). */
  window?: SavedWindow;
}

// Dark by default: the approved look (owner, 2026-10-26).
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', libraryFolders: [], mapFolders: [], voiceCleanup: true, playerMerges: {}, playerRejected: [], aiVoice: false, aiVoiceDemos: {}, updateCheck: true };

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
  const out: Settings = { ...DEFAULT_SETTINGS, libraryFolders: [], mapFolders: [], playerMerges: {}, playerRejected: [], aiVoiceDemos: {} };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.theme === 'string' && (THEME_CHOICES as readonly string[]).includes(r.theme)) out.theme = r.theme as ThemeChoice;
    out.libraryFolders = cleanPaths(r.libraryFolders);
    out.mapFolders = cleanPaths(r.mapFolders);
    if (typeof r.outputFolder === 'string' && r.outputFolder.trim()) out.outputFolder = r.outputFolder;
    if (typeof r.gameDir === 'string' && r.gameDir.trim()) out.gameDir = r.gameDir;
    if (typeof r.voiceCleanup === 'boolean') out.voiceCleanup = r.voiceCleanup;
    if (r.playerMerges && typeof r.playerMerges === 'object') {
      for (const [k, v] of Object.entries(r.playerMerges as Record<string, unknown>)) if (typeof v === 'string' && k && v && k !== v) out.playerMerges[k] = v;
    }
    out.playerRejected = cleanPaths(r.playerRejected);
    if (typeof r.speechModel === 'string' && r.speechModel.trim()) out.speechModel = r.speechModel;
    if (typeof r.aiVoice === 'boolean') out.aiVoice = r.aiVoice;
    if (r.aiVoiceDemos && typeof r.aiVoiceDemos === 'object') {
      for (const [k, v] of Object.entries(r.aiVoiceDemos as Record<string, unknown>)) if (k && typeof v === 'boolean') out.aiVoiceDemos[k] = v;
    }
    if (typeof r.updateCheck === 'boolean') out.updateCheck = r.updateCheck;
    if (typeof r.aiModel === 'string' && r.aiModel.trim()) out.aiModel = r.aiModel;
    const w = cleanSavedWindow(r.window);
    if (w) out.window = w;
    if (typeof r.cpuCores === 'number' && Number.isInteger(r.cpuCores) && r.cpuCores >= 1 && r.cpuCores <= 1024) out.cpuCores = r.cpuCores;
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
