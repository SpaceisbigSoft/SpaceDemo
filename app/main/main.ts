// SpaceDemo app: the main process (plans 4.2, 4.3). Opens the window, keeps the settings and answers the window's few requests.
// Safety: the window runs sandboxed with no access to Node.js or files; it can only call the named functions in
// app/shared/api.ts. Links to websites open in the normal browser, never inside the app. Nothing here touches the game.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron';
import { MIN_WINDOW, startBounds } from './window-state.js';
import { appendFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { IPC, THEME_CHOICES, type AppInfo, type AppSettingsView, type GameStatus, type ThemeChoice, type ThemeState } from '../shared/api.js';
import { gameStatus, toGameStatus } from './game.js';
import { checkGameDir, findGame } from '../../engine/src/launch/steam.js';
import { AI_STYLE } from '../../engine/src/voice/enhance.js';
import { FixedStore } from './fixed-store.js';
import { WatchService } from './watch-service.js';
import { FixService } from './fix-service.js';
import { physicalCores, SpeechService, suggestedCores, usableCores } from './speech-service.js';
import { AiModelService } from './ai-model.js';
import { UpdateService, type UpdaterLike } from './updates.js';
import type { FixJob } from './fixer.js';
import { findCandidates } from './library.js';
import { LibraryService } from './library-service.js';
import { PlayersService } from './players-service.js';
import { loadSettings, saveSettings, settingsFile, type Settings } from './settings.js';
import { workerReader } from './worker-reader.js';

// Tests run the app with their own data folder so they never read or change the person's settings.
if (process.env.SPACEDEMO_USER_DATA) app.setPath('userData', process.env.SPACEDEMO_USER_DATA);

/** Colours of the window's top strip and its minimise/maximise/close buttons, per theme (match styles.css). */
const TITLE_BAR = {
  dark: { color: '#1b1e22', symbolColor: '#e8eaed', background: '#15171a' },
  light: { color: '#ffffff', symbolColor: '#1b1e22', background: '#f4f5f7' },
} as const;
export const TITLE_BAR_HEIGHT = 36;

let settings: Settings;
let file: string;
let win: BrowserWindow | undefined;
let game: GameStatus | undefined;
let library: LibraryService;
let watcher: WatchService;
let fixer: FixService;
let aiModel: AiModelService;

/** 4.10: AI voice for one demo: its own choice from the library, else Settings → AI voice. */
function aiVoiceFor(key?: string): boolean {
  return key !== undefined && key in settings.aiVoiceDemos ? settings.aiVoiceDemos[key] : settings.aiVoice;
}

/** 5.g5: the AI part of a fix job when AI voice is on (for this demo) and the model is there (undefined = plain fix). */
function aiJob(key?: string): FixJob['ai'] {
  const model = aiVoiceFor(key) ? aiModel?.modelPath() : undefined;
  return model ? { model, threads: usableCores(settings.cpuCores), cacheDir: aiModel.cacheDir() } : undefined;
}
let fixedStore: FixedStore;
let players: PlayersService;
let speech: SpeechService;
let updates: UpdateService;
// Tests and screenshots only: SPACEDEMO_FAKE_UPDATE=<version> pretends GitHub has that version (nothing is downloaded).
const FAKE_UPDATE = process.env.SPACEDEMO_FAKE_UPDATE;
function fakeUpdater(version: string): UpdaterLike {
  let progress: ((p: { percent: number }) => void) | undefined;
  return {
    autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false,
    checkForUpdates: async () => ({ updateInfo: { version, releaseNotes: '<p>Test release notes.</p><ul><li>One change</li><li>Another change</li></ul>' } }),
    downloadUpdate: async () => { for (const p of [25, 60, 100]) { await new Promise((r) => setTimeout(r, 150)); progress?.({ percent: p }); } return []; },
    quitAndInstall: () => { appendFileSync(join(app.getPath('userData'), 'fake-update-log.txt'), 'quitAndInstall\n'); },
    on: (_e, l) => { progress = l; return undefined; },
  };
}

/** Test-only switches: a stand-in game folder, and "pretend to start Steam" (writes what it would run to a log). */
const TEST_GAME_DIR = process.env.SPACEDEMO_GAME_DIR;
const DRY_LAUNCH = process.env.SPACEDEMO_DRY_LAUNCH === '1';

function findRaw() {
  const gameDir = settings?.gameDir ?? TEST_GAME_DIR;
  const found = findGame(gameDir ? { gameDir } : {});
  // Tests have no Steam: a stand-in so the plan can be made (nothing is started in DRY_LAUNCH).
  if (DRY_LAUNCH && !found.steam) found.steam = { dir: '/steam', exe: '/steam/steam.exe', source: 'manual' };
  return found;
}

function outputFolder(): string {
  return settings.outputFolder ?? process.env.SPACEDEMO_OUTPUT_DIR ?? join(app.getPath('documents'), 'SpaceDemo', 'Fixed demos');
}

function findGameNow(): GameStatus {
  // SPACEDEMO_GAME_DIR: tests point the app at a stand-in game folder.
  try { game = toGameStatus(findRaw()); } catch { game = gameStatus(); }
  return game;
}

function saveAndApply(next: Settings): void {
  settings = next;
  saveSettings(file, settings);
}

function settingsView(): AppSettingsView {
  const cpu = { cores: usableCores(settings.cpuCores), chosen: settings.cpuCores !== undefined, suggested: suggestedCores(), max: physicalCores() };
  return { theme: settings.theme, mapFolders: [...settings.mapFolders], outputFolder: outputFolder(), gameDir: settings.gameDir, voiceCleanup: settings.voiceCleanup, cpu, aiVoice: { on: settings.aiVoice, active: !!aiJob() }, updateCheck: settings.updateCheck };
}

/** Paths from the window: kept only if they are absolute and exist. */
function cleanPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is string => typeof p === 'string' && isAbsolute(p) && existsSync(p));
}

async function pickFolders(title: string, multi: boolean): Promise<string[]> {
  const opts: Electron.OpenDialogOptions = { title, properties: multi ? ['openDirectory', 'multiSelections'] : ['openDirectory'] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? [] : r.filePaths;
}

function currentTitleBar() {
  return nativeTheme.shouldUseDarkColors ? TITLE_BAR.dark : TITLE_BAR.light;
}

function themeState(): ThemeState {
  return { choice: settings.theme, dark: nativeTheme.shouldUseDarkColors };
}

function applyTheme(theme: ThemeChoice): void {
  // 'system' follows Windows' own light/dark setting. The window is told the look directly (theme:changed) and sets
  // data-theme on its page, so it never depends on the page's own idea of the system colours.
  nativeTheme.themeSource = theme;
}

function themeChanged(): void {
  const t = currentTitleBar();
  win?.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: TITLE_BAR_HEIGHT });
  win?.setBackgroundColor(t.background);
  win?.webContents.send(IPC.themeChanged, themeState());
}

/** Our helper programs: next to the app in development, in resources\helpers when installed (6.1, not inside app.asar). */
function helpersBase(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

// 6.1 `.dem` file association: Windows starts SpaceDemo with the demo's path (or passes it to the open SpaceDemo).
// The demo is added to the library (unless a library folder already holds it) and its details page opens.
let pendingOpen: string | undefined;
function demoArg(argv: string[]): string | undefined {
  return argv.slice(1).find((a) => /\.dem$/i.test(a) && isAbsolute(a) && existsSync(a));
}
function openDemoFile(path: string): void {
  const lower = path.toLowerCase();
  const covered = settings.libraryFolders.some((f) => { const l = f.toLowerCase(); return lower === l || lower.startsWith(l.endsWith(sep) ? l : l + sep); });
  if (!covered) {
    saveAndApply({ ...settings, libraryFolders: [...settings.libraryFolders, path] });
    void library.refresh();
  }
  pendingOpen = path;
  win?.webContents.send(IPC.openDemo, path);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
}

function createWindow(): void {
  const tb = currentTitleBar();
  const bounds = startBounds(settings.window, screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    title: 'SpaceDemo',
    backgroundColor: tb.background,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: tb.color, symbolColor: tb.symbolColor, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // The look to start with, so the first paint already has the right colours (read by the preload).
      additionalArguments: [`--spacedemo-theme=${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`],
    },
  });

  win.once('ready-to-show', () => {
    if (settings.window?.maximized) win?.maximize();
    win?.show();
  });
  // Remember the size and place for next time (the normal size even when maximized).
  win.on('close', () => {
    if (!win || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    settings = { ...settings, window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } };
    try { saveSettings(file, settings); } catch { /* not critical */ }
  });
  win.on('closed', () => { win = undefined; });

  // Never navigate the app window away, and never open new app windows: web links go to the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function registerIpc(): void {
  ipcMain.handle(IPC.info, (): AppInfo => ({
    name: 'SpaceDemo',
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  }));
  ipcMain.handle(IPC.findGame, () => {
    const before = game?.gameDir;
    const now = findGameNow();
    if (now.gameDir !== before) void library.refresh(); // map checks depend on the game's maps
    return now;
  });
  ipcMain.handle(IPC.getTheme, () => themeState());
  ipcMain.handle(IPC.setTheme, (_event, theme: unknown) => {
    if (typeof theme !== 'string' || !(THEME_CHOICES as readonly string[]).includes(theme)) return themeState();
    settings = { ...settings, theme: theme as ThemeChoice };
    saveSettings(file, settings);
    applyTheme(settings.theme);
    themeChanged();
    return themeState();
  });

  // ---- Library (plan 4.3): folders are only read ----
  ipcMain.handle(IPC.libraryGet, () => library.state());
  ipcMain.handle(IPC.libraryAdd, async (_e, paths: unknown) => {
    const add = paths === undefined ? await pickFolders('Add a folder of demos', true) : cleanPaths(paths);
    const next = [...settings.libraryFolders];
    for (const p of add) if (!next.some((q) => q.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length !== settings.libraryFolders.length) {
      saveAndApply({ ...settings, libraryFolders: next });
      void library.refresh();
    }
    return library.state();
  });
  ipcMain.handle(IPC.takeOpenDemo, () => { const p = pendingOpen; pendingOpen = undefined; return p; });
  ipcMain.handle(IPC.libraryRemove, (_e, path: unknown) => {
    if (typeof path === 'string' && settings.libraryFolders.includes(path)) {
      saveAndApply({ ...settings, libraryFolders: settings.libraryFolders.filter((p) => p !== path) });
      void library.refresh();
    }
    return library.state();
  });
  ipcMain.handle(IPC.libraryRescan, () => { void library.refresh(); return library.state(); });
  ipcMain.handle(IPC.demoDetails, (_e, key: unknown) => (typeof key === 'string' ? library.details(key) : { error: 'No demo given.' }));
  ipcMain.handle(IPC.playersGet, () => players.view());
  ipcMain.handle(IPC.playersMerge, (_e, alias: unknown, into: unknown) => {
    if (typeof alias === 'string' && typeof into === 'string' && alias && into && alias !== into) {
      // Anything merged into the alias goes to the new name too.
      const merges: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings.playerMerges)) merges[k] = v === alias ? into : v;
      merges[alias] = into;
      delete merges[into];
      saveAndApply({ ...settings, playerMerges: merges });
    }
    return players.refresh();
  });
  ipcMain.handle(IPC.playersUnmerge, (_e, alias: unknown) => {
    if (typeof alias === 'string') { const merges = { ...settings.playerMerges }; delete merges[alias]; saveAndApply({ ...settings, playerMerges: merges }); }
    return players.refresh();
  });
  ipcMain.handle(IPC.playersReject, (_e, a: unknown, b: unknown) => {
    if (typeof a === 'string' && typeof b === 'string') {
      const pair = [a, b].sort().join('|');
      if (!settings.playerRejected.includes(pair)) saveAndApply({ ...settings, playerRejected: [...settings.playerRejected, pair] });
    }
    return players.refresh();
  });
  ipcMain.handle(IPC.demoReplay, (_e, key: unknown, round: unknown, combined: unknown) => (typeof key === 'string' && Number.isInteger(round) ? library.replay(key, round as number, combined === true) : { error: 'No demo or round given.' }));
  ipcMain.handle(IPC.demoCombined, (_e, key: unknown) => (typeof key === 'string' ? library.combined(key) : { error: 'No demo given.' }));
  ipcMain.handle(IPC.watchInfo, (_e, key: unknown) => (typeof key === 'string' ? watcher.info(key) : { error: 'No demo given.' }));
  ipcMain.handle(IPC.watchStart, (_e, key: unknown, options: unknown) => {
    const o = (options ?? {}) as { speed?: unknown; keepCopy?: unknown };
    const speed = typeof o.speed === 'number' && o.speed > 0 && o.speed <= 4 ? o.speed : 1;
    return typeof key === 'string' ? watcher.watch(key, { speed, keepCopy: o.keepCopy === true }) : { key: '', stage: 'error', message: 'No demo given.' };
  });
  ipcMain.handle(IPC.fixDemos, (_e, keys: unknown) => fixer.addLibrary(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []));
  ipcMain.handle(IPC.fixFiles, async (_e, paths: unknown) => {
    let files = paths === undefined ? [] : cleanPaths(paths);
    if (paths === undefined) {
      const opts: Electron.OpenDialogOptions = { title: 'Choose old demos to fix', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Demos and zips', extensions: ['dem', 'zip'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      files = r.canceled ? [] : r.filePaths;
    }
    return fixer.addCandidates(findCandidates(files).candidates);
  });
  ipcMain.handle(IPC.fixStop, () => fixer.stop());
  ipcMain.handle(IPC.fixGet, () => fixer.state());
  ipcMain.handle(IPC.openOutput, async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(outputFolder(), { recursive: true });
    await shell.openPath(outputFolder());
  });
  // 6.7 updates from GitHub releases.
  ipcMain.handle(IPC.updateGet, () => updates.state());
  ipcMain.handle(IPC.updateCheck, () => updates.check(true));
  ipcMain.handle(IPC.updateDownload, () => updates.download());
  ipcMain.handle(IPC.updateInstall, () => updates.install());
  ipcMain.handle(IPC.updateCheckSet, (_e, on: unknown) => {
    if (typeof on === 'boolean') saveAndApply({ ...settings, updateCheck: on });
    return settingsView();
  });
  // 6.4: the notices and the GPL text sit next to the helpers (resources\ when installed, the repository in development).
  ipcMain.handle(IPC.openLicence, async (_e, which: unknown) => {
    const file = join(helpersBase(), which === 'licence' ? (app.isPackaged ? 'LICENSE.txt' : 'LICENSE') : 'THIRD-PARTY-NOTICES.txt');
    if (!existsSync(file)) return `Not found: ${file}`;
    return shell.openPath(file);
  });
  ipcMain.handle(IPC.gameFolderChoose, async (_e, path: unknown) => {
    const [dir] = path === undefined ? await pickFolders('Choose the Half-Life folder (the one with hl.exe and cstrike)', false) : cleanPaths([path]);
    if (!dir) return settingsView();
    const problem = checkGameDir(dir);
    if (problem) return { ...settingsView(), problem };
    saveAndApply({ ...settings, gameDir: dir });
    findGameNow();
    void library.refresh();
    return settingsView();
  });
  ipcMain.handle(IPC.gameFolderClear, () => {
    saveAndApply({ ...settings, gameDir: undefined });
    findGameNow();
    void library.refresh();
    return settingsView();
  });
  ipcMain.handle(IPC.aiVoiceSet, (_e, on: unknown) => {
    if (typeof on === 'boolean') {
      // The demos' own choices stay; one that now equals the default is just following it again.
      const aiVoiceDemos = Object.fromEntries(Object.entries(settings.aiVoiceDemos).filter(([, v]) => v !== on));
      saveAndApply({ ...settings, aiVoice: on, aiVoiceDemos });
      library.fixedChangedAll();
    }
    return settingsView();
  });
  ipcMain.handle(IPC.aiVoiceDemoSet, (_e, key: unknown, on: unknown) => {
    // 4.10: one library demo's own choice; Settings → AI voice stays the default for every other demo.
    if (typeof key !== 'string' || typeof on !== 'boolean' || !library.row(key)) return;
    const aiVoiceDemos = { ...settings.aiVoiceDemos };
    if (on === settings.aiVoice) delete aiVoiceDemos[key];
    else aiVoiceDemos[key] = on;
    saveAndApply({ ...settings, aiVoiceDemos });
    library.fixedChanged(key);
  });
  ipcMain.handle(IPC.aiModelGet, () => aiModel.model());
  ipcMain.handle(IPC.aiModelDownload, async () => { const s = await aiModel.download(); library.fixedChangedAll(); return s; });
  ipcMain.handle(IPC.aiModelChoose, async (_e, path: unknown) => {
    let p = typeof path === 'string' && isAbsolute(path) ? path : undefined;
    if (!p) {
      const opts: Electron.OpenDialogOptions = { title: 'Choose the AI voice model file', properties: ['openFile'], filters: [{ name: 'AI voice model', extensions: ['onnx'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      p = r.canceled ? undefined : r.filePaths[0];
    }
    const s = p ? aiModel.choose(p) : aiModel.model();
    library.fixedChangedAll();
    return s;
  });
  ipcMain.handle(IPC.cpuCoresSet, (_e, cores: unknown) => {
    if (cores === null) saveAndApply({ ...settings, cpuCores: undefined });
    else if (typeof cores === 'number' && Number.isInteger(cores) && cores >= 1) saveAndApply({ ...settings, cpuCores: Math.min(cores, physicalCores()) });
    return settingsView();
  });
  ipcMain.handle(IPC.voiceCleanupSet, (_e, on: unknown) => {
    if (typeof on === 'boolean') saveAndApply({ ...settings, voiceCleanup: on });
    return settingsView();
  });
  ipcMain.handle(IPC.outputFolderChoose, async () => {
    const [p] = await pickFolders('Choose where fixed demos are saved', false);
    if (p) saveAndApply({ ...settings, outputFolder: p });
    return settingsView();
  });
  ipcMain.handle(IPC.showInFolder, (_e, path: unknown) => {
    if (typeof path === 'string' && isAbsolute(path) && existsSync(path)) shell.showItemInFolder(path);
  });

  // ---- Settings: map pool ----
  ipcMain.handle(IPC.settingsGet, () => settingsView());
  // 5.v voice to text.
  ipcMain.handle(IPC.speechModelGet, () => speech.model());
  ipcMain.handle(IPC.speechModelDownload, () => speech.download());
  ipcMain.handle(IPC.speechModelChoose, async (_e, path: unknown) => {
    let p = typeof path === 'string' && isAbsolute(path) ? path : undefined;
    if (!p) {
      const opts: Electron.OpenDialogOptions = { title: 'Choose the speech model file', properties: ['openFile'], filters: [{ name: 'Speech model', extensions: ['bin'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      p = r.canceled ? undefined : r.filePaths[0];
    }
    return p ? speech.choose(p) : speech.model();
  });
  ipcMain.handle(IPC.transcriptGet, (_e, key: unknown) => (typeof key === 'string' ? speech.transcript(key) : { key: '', status: 'failed', error: 'No demo given.' }));
  ipcMain.handle(IPC.transcriptStart, (_e, key: unknown) => (typeof key === 'string' ? speech.start(key) : { key: '', status: 'failed', error: 'No demo given.' }));
  ipcMain.handle(IPC.transcriptStop, () => speech.stop());
  ipcMain.handle(IPC.mapFolderAdd, async (_e, path: unknown) => {
    const add = path === undefined ? await pickFolders('Choose a folder with old map versions', false) : cleanPaths([path]);
    const next = [...settings.mapFolders];
    for (const p of add) if (!next.some((q) => q.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length !== settings.mapFolders.length) {
      saveAndApply({ ...settings, mapFolders: next });
      void library.refresh();
    }
    return settingsView();
  });
  ipcMain.handle(IPC.mapFolderRemove, (_e, path: unknown) => {
    if (typeof path === 'string' && settings.mapFolders.includes(path)) {
      saveAndApply({ ...settings, mapFolders: settings.mapFolders.filter((p) => p !== path) });
      void library.refresh();
    }
    return settingsView();
  });
}

// One SpaceDemo at a time: starting it again brings the open window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const dem = demoArg(argv);
    if (dem && library) openDemoFile(dem);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    file = settingsFile(app.getPath('userData'));
    settings = loadSettings(file);
    applyTheme(settings.theme);
    nativeTheme.on('updated', themeChanged);
    fixedStore = new FixedStore(join(app.getPath('userData'), 'fixed.json'));
    const reader = workerReader(join(__dirname, 'scan-worker.cjs'));
    aiModel = new AiModelService({
      dataDir: app.getPath('userData'), modelUrl: process.env.SPACEDEMO_AI_MODEL_URL,
      chosenModel: () => settings.aiModel,
      saveChosenModel: (path) => saveAndApply({ ...settings, aiModel: path }),
      onModel: (st) => win?.webContents.send(IPC.aiModelChanged, st),
    });
    library = new LibraryService({
      cacheFile: join(app.getPath('userData'), 'library-cache.json'),
      reader,
      // A fixed copy counts only if it was made the way fixing works now (with or without AI voice, 5.g5).
      fixedCopy: (key, source) => { const r = fixedStore.get(key, source); return r && (aiJob(key) ? r.ai && r.aiStyle === AI_STYLE : !r.ai) ? r.output : undefined; },
      aiVoice: (key) => aiVoiceFor(key),
      roots: () => settings.libraryFolders,
      mapFolders: () => settings.mapFolders,
      gameDir: () => game?.gameDir,
      onChange: (state) => win?.webContents.send(IPC.libraryChanged, state),
    });
    players = new PlayersService({
      library, reader, cacheFile: join(app.getPath('userData'), 'players-cache.json'),
      merges: () => settings.playerMerges, rejected: () => settings.playerRejected,
      onChange: (view) => win?.webContents.send(IPC.playersChanged, view),
    });
    const launchLog = join(app.getPath('userData'), 'launch-log.txt');
    fixer = new FixService({
      library, reader, fixed: fixedStore, gameDir: () => game?.gameDir, outputFolder, cleanup: () => settings.voiceCleanup, ai: aiJob, mapFolders: () => settings.mapFolders,
      helperExe: join(helpersBase(), 'helpers', 'voice-helper', 'cdf-voice-helper.exe'),
      onChange: (s) => win?.webContents.send(IPC.fixChanged, s),
    });
    watcher = new WatchService({
      library, fixed: fixedStore, fixer, findGame: findRaw, outputFolder, mapFolders: () => settings.mapFolders,
      onProgress: (p) => win?.webContents.send(IPC.watchProgress, p),
      ...(DRY_LAUNCH ? { start: (exe: string, args: string[]) => appendFileSync(launchLog, JSON.stringify({ exe, args }) + '\n'), gameRunning: () => false, noWait: true } : {}),
    });
    speech = new SpeechService({
      dataDir: app.getPath('userData'), library, reader, gameDir: () => game?.gameDir,
      voiceHelperExe: join(helpersBase(), 'helpers', 'voice-helper', 'cdf-voice-helper.exe'),
      whisperExe: process.env.SPACEDEMO_WHISPER_EXE ?? join(helpersBase(), 'helpers', 'whisper-helper', 'spacedemo-whisper.exe'),
      wine: process.env.SPACEDEMO_WHISPER_WINE, modelUrl: process.env.SPACEDEMO_MODEL_URL,
      cores: () => usableCores(settings.cpuCores),
      chosenModel: () => settings.speechModel,
      saveChosenModel: (path) => saveAndApply({ ...settings, speechModel: path }),
      onModel: (st) => win?.webContents.send(IPC.speechModelChanged, st),
      onTranscript: (st) => win?.webContents.send(IPC.transcriptChanged, st),
    });
    // 6.7: only the installed Windows app updates itself (SPACEDEMO_NO_UPDATES turns it off, e.g. for tests).
    updates = new UpdateService({
      current: app.getVersion(),
      supported: !!FAKE_UPDATE || (app.isPackaged && process.platform === 'win32' && !process.env.SPACEDEMO_NO_UPDATES),
      updater: async () => (FAKE_UPDATE ? fakeUpdater(FAKE_UPDATE) : (await import('electron-updater')).autoUpdater as unknown as UpdaterLike),
      onChange: (s) => win?.webContents.send(IPC.updateChanged, s),
    });
    findGameNow();
    registerIpc();
    createWindow();
    if (settings.updateCheck) setTimeout(() => { void updates.check(); }, FAKE_UPDATE ? 500 : 8000);
    void library.refresh();
    const dem = demoArg(process.argv);
    if (dem) openDemoFile(dem);
  });

  app.on('window-all-closed', () => { library?.close(); app.quit(); });
}
