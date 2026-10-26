// What the window (renderer) may ask the app (main process) for. The window never touches files or programs itself:
// every request goes through these few named calls (Electron's contextBridge), and the main process decides.

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** The Steam copy of Counter-Strike 1.6, as found by the engine's finder (plan 3.1). Read-only. */
export interface GameStatus {
  found: boolean;
  /** The Half-Life folder (has hl.exe and cstrike). */
  gameDir?: string;
  /** The Steam library it was found in, e.g. "D:\SteamLibrary". */
  library?: string;
  /** cstrike\steam.inf PatchVersion, e.g. "1.1.2.7". */
  version?: string;
  /** Steam build id from appmanifest_10.acf. */
  buildId?: string;
  steamExe?: string;
  /** Plain-language problems that stop playback (empty = ready). */
  problems: string[];
  notes: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  platform: string;
}

/** The person's choice and the look actually used (for 'system': Windows' own setting). */
export interface ThemeState {
  choice: ThemeChoice;
  dark: boolean;
}

export interface SpaceDemoApi {
  info(): Promise<AppInfo>;
  findGame(): Promise<GameStatus>;
  getTheme(): Promise<ThemeState>;
  setTheme(theme: ThemeChoice): Promise<ThemeState>;
  /** Called when the look changes (the choice, or Windows switching light/dark). Returns a function that stops it. */
  onThemeChanged(listener: (state: ThemeState) => void): () => void;
}

/** IPC channel names (one place, so main and preload can't drift apart). */
export const IPC = {
  info: 'app:info',
  findGame: 'game:find',
  getTheme: 'theme:get',
  setTheme: 'theme:set',
  themeChanged: 'theme:changed',
} as const;

declare global {
  interface Window {
    spacedemo: SpaceDemoApi;
  }
}
