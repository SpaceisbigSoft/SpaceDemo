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

/** What the library shows for one demo (plan 4.3). Read from the demo once and cached. */
export interface LibraryDemo {
  /** Unique key: the file path, plus "::" and the entry name for a demo inside a zip. */
  key: string;
  /** Demo name without .dem. */
  name: string;
  /** The .dem file, or the .zip that holds it. */
  file: string;
  /** Path inside the zip, when the demo is in one. */
  zipEntry?: string;
  /** Other places with an identical copy (same name and size). */
  alsoAt: string[];
  /** The library folder it was found under. */
  folder: string;
  size: number;
  /** Recording date in ms: the zip entry's date, else the file's date. */
  date: number;
  dateSource: 'zip' | 'file';
  /** Filled after reading the demo; missing while it waits. */
  info?: DemoSummary;
  /** Plain-language reason it couldn't be read. */
  error?: string;
  map?: MapStatus;
  status: DemoStatus;
}

export type DemoStatus = 'waiting' | 'plays' | 'needs-fix' | 'damaged' | 'not-cs' | 'unreadable';

export interface DemoSummary {
  networkProtocol: number;
  gameDir: string;
  recording: 'POV' | 'HLTV';
  map: string;
  /** All maps played, in order (more than one = the demo changes map). */
  maps: string[];
  mapChecksum: number;
  seconds: number;
  hostName?: string;
  voiceCodec?: string;
  /** Total talk time of everyone heard (Miles voice: measured; other codecs: undefined). */
  voiceSeconds?: number;
  talkBursts: number;
  /** Who is heard talking (names). */
  talkers: string[];
  players: string[];
  recorder?: string;
  directoryOk: boolean;
  problems: string[];
}

export interface MapStatus {
  kind: 'ok' | 'warn' | 'bad' | 'unknown';
  /** Short text for the table, e.g. "installed", "old version · map pool", "map missing". */
  note: string;
}

export interface LibraryState {
  folders: string[];
  demos: LibraryDemo[];
  /** Set while demos are being read. */
  scan?: { done: number; total: number };
}

/** The details page of one demo (plan 4.4). Built when the page opens; nothing is written. */
export interface DemoDetails {
  key: string;
  teams: { T: TeamDetails; CT: TeamDetails };
  /** Final score of this recording: the server's own numbers when sent, else rounds counted. */
  score?: { T: number; CT: number; source: 'server' | 'rounds'; matchesRounds: boolean };
  rounds: { number: number; winner?: 'T' | 'CT' | 'draw'; reason?: string }[];
  chat: { time: number; who?: string; team?: 'T' | 'CT'; text: string; teamOnly: boolean; dead: boolean }[];
  /** Talk time per player, most first. */
  talk: { name: string; seconds: number; team?: 'T' | 'CT' }[];
  talkBursts: number;
  map: DetailsMap;
  /** Warm-up restarts skipped (data before the last restart isn't counted). */
  restarts: number;
}

export interface TeamDetails {
  /** Clan tag shared by most of the team's players (e.g. "i69"), when there is one. */
  tag?: string;
  players: PlayerRow[];
  /** False when nobody on this team is heard (a POV demo holds only the recorder's team voice). */
  heard: boolean;
}

export interface PlayerRow {
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
  talkSeconds: number;
  recorder: boolean;
}

export interface DetailsMap {
  /** The game's overview picture (data: URL), only when it matches this demo's map version. */
  image?: string;
  /** Bomb sites on the picture (pixels of the 1024x768 image). */
  sites: { letter: string; x: number; y: number }[];
  /** Why there is no picture, in plain words. */
  note?: string;
}

export interface AppSettingsView {
  theme: ThemeChoice;
  /** Folders with old map versions (the map pool). */
  mapFolders: string[];
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

  /** Library (plan 4.3). Folders are only read. */
  getLibrary(): Promise<LibraryState>;
  /** Adds folders (or single .dem / .zip files). No paths = ask with Windows' folder picker. */
  addToLibrary(paths?: string[]): Promise<LibraryState>;
  removeFromLibrary(path: string): Promise<LibraryState>;
  rescanLibrary(): Promise<LibraryState>;
  onLibraryChanged(listener: (state: LibraryState) => void): () => void;
  /** The file path of a file dropped on the window. */
  pathForFile(file: File): string;
  /** Opens Windows Explorer with this file selected (read-only). */
  showInFolder(path: string): Promise<void>;

  /** Details of a library demo (plan 4.4), by its library key. Reads the demo; changes nothing. */
  getDemoDetails(key: string): Promise<DemoDetails | { error: string }>;

  getSettings(): Promise<AppSettingsView>;
  /** Adds a map-pool folder (no path = ask with the folder picker). */
  addMapFolder(path?: string): Promise<AppSettingsView>;
  removeMapFolder(path: string): Promise<AppSettingsView>;
}

/** IPC channel names (one place, so main and preload can't drift apart). */
export const IPC = {
  info: 'app:info',
  findGame: 'game:find',
  getTheme: 'theme:get',
  setTheme: 'theme:set',
  themeChanged: 'theme:changed',
  libraryGet: 'library:get',
  libraryAdd: 'library:add',
  libraryRemove: 'library:remove',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  showInFolder: 'shell:show-in-folder',
  demoDetails: 'library:details',
  settingsGet: 'settings:get',
  mapFolderAdd: 'settings:map-folder-add',
  mapFolderRemove: 'settings:map-folder-remove',
} as const;

declare global {
  interface Window {
    spacedemo: SpaceDemoApi;
  }
}
