// SpaceDemo app: the main process (plans 4.2, 4.3). Opens the window, keeps the settings and answers the window's few requests.
// Safety: the window runs sandboxed with no access to Node.js or files; it can only call the named functions in
// app/shared/api.ts. Links to websites open in the normal browser, never inside the app. Nothing here touches the game.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { IPC, THEME_CHOICES, type AppInfo, type AppSettingsView, type GameStatus, type ThemeChoice, type ThemeState } from '../shared/api.js';
import { gameStatus } from './game.js';
import { LibraryService } from './library-service.js';
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

function findGameNow(): GameStatus {
  // SPACEDEMO_GAME_DIR: tests point the app at a stand-in game folder.
  game = gameStatus(process.env.SPACEDEMO_GAME_DIR ? { gameDir: process.env.SPACEDEMO_GAME_DIR } : {});
  return game;
}

function saveAndApply(next: Settings): void {
  settings = next;
  saveSettings(file, settings);
}

function settingsView(): AppSettingsView {
  return { theme: settings.theme, mapFolders: [...settings.mapFolders] };
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

function createWindow(): void {
  const tb = currentTitleBar();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
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

  win.once('ready-to-show', () => win?.show());
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
  ipcMain.handle(IPC.libraryRemove, (_e, path: unknown) => {
    if (typeof path === 'string' && settings.libraryFolders.includes(path)) {
      saveAndApply({ ...settings, libraryFolders: settings.libraryFolders.filter((p) => p !== path) });
      void library.refresh();
    }
    return library.state();
  });
  ipcMain.handle(IPC.libraryRescan, () => { void library.refresh(); return library.state(); });
  ipcMain.handle(IPC.showInFolder, (_e, path: unknown) => {
    if (typeof path === 'string' && isAbsolute(path) && existsSync(path)) shell.showItemInFolder(path);
  });

  // ---- Settings: map pool ----
  ipcMain.handle(IPC.settingsGet, () => settingsView());
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
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    file = settingsFile(app.getPath('userData'));
    settings = loadSettings(file);
    applyTheme(settings.theme);
    nativeTheme.on('updated', themeChanged);
    library = new LibraryService({
      cacheFile: join(app.getPath('userData'), 'library-cache.json'),
      reader: workerReader(join(__dirname, 'scan-worker.cjs')),
      roots: () => settings.libraryFolders,
      mapFolders: () => settings.mapFolders,
      gameDir: () => game?.gameDir,
      onChange: (state) => win?.webContents.send(IPC.libraryChanged, state),
    });
    findGameNow();
    registerIpc();
    createWindow();
    void library.refresh();
  });

  app.on('window-all-closed', () => { library?.close(); app.quit(); });
}
