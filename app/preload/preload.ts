// The only bridge between the window and the app: a fixed list of named calls (see app/shared/api.ts).
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type FixBatchState, type LibraryState, type SpaceDemoApi, type ThemeChoice, type ThemeState, type WatchProgress } from '../shared/api.js';

const api: SpaceDemoApi = {
  info: () => ipcRenderer.invoke(IPC.info),
  findGame: () => ipcRenderer.invoke(IPC.findGame),
  getTheme: () => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (theme: ThemeChoice) => ipcRenderer.invoke(IPC.setTheme, theme),
  onThemeChanged: (listener: (state: ThemeState) => void) => {
    const handler = (_event: unknown, state: ThemeState) => listener(state);
    ipcRenderer.on(IPC.themeChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.themeChanged, handler); };
  },
  getLibrary: () => ipcRenderer.invoke(IPC.libraryGet),
  addToLibrary: (paths?: string[]) => ipcRenderer.invoke(IPC.libraryAdd, paths),
  removeFromLibrary: (path: string) => ipcRenderer.invoke(IPC.libraryRemove, path),
  rescanLibrary: () => ipcRenderer.invoke(IPC.libraryRescan),
  onLibraryChanged: (listener: (state: LibraryState) => void) => {
    const handler = (_event: unknown, state: LibraryState) => listener(state);
    ipcRenderer.on(IPC.libraryChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.libraryChanged, handler); };
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  showInFolder: (path: string) => ipcRenderer.invoke(IPC.showInFolder, path),
  getDemoDetails: (key: string) => ipcRenderer.invoke(IPC.demoDetails, key),
  getReplay: (key: string, round: number) => ipcRenderer.invoke(IPC.demoReplay, key, round),
  getWatchInfo: (key: string) => ipcRenderer.invoke(IPC.watchInfo, key),
  watch: (key: string, options: { speed?: number; keepCopy?: boolean }) => ipcRenderer.invoke(IPC.watchStart, key, options),
  onWatchProgress: (listener: (p: WatchProgress) => void) => {
    const handler = (_event: unknown, p: WatchProgress) => listener(p);
    ipcRenderer.on(IPC.watchProgress, handler);
    return () => { ipcRenderer.removeListener(IPC.watchProgress, handler); };
  },
  chooseOutputFolder: () => ipcRenderer.invoke(IPC.outputFolderChoose),
  fixDemos: (keys: string[]) => ipcRenderer.invoke(IPC.fixDemos, keys),
  fixFiles: (paths?: string[]) => ipcRenderer.invoke(IPC.fixFiles, paths),
  stopFixing: () => ipcRenderer.invoke(IPC.fixStop),
  getFixBatch: () => ipcRenderer.invoke(IPC.fixGet),
  onFixBatch: (listener: (s: FixBatchState) => void) => {
    const handler = (_event: unknown, s: FixBatchState) => listener(s);
    ipcRenderer.on(IPC.fixChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.fixChanged, handler); };
  },
  openOutputFolder: () => ipcRenderer.invoke(IPC.openOutput),
  chooseGameFolder: (path?: string) => ipcRenderer.invoke(IPC.gameFolderChoose, path),
  clearGameFolder: () => ipcRenderer.invoke(IPC.gameFolderClear),
  setVoiceCleanup: (on: boolean) => ipcRenderer.invoke(IPC.voiceCleanupSet, on),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  addMapFolder: (path?: string) => ipcRenderer.invoke(IPC.mapFolderAdd, path),
  removeMapFolder: (path: string) => ipcRenderer.invoke(IPC.mapFolderRemove, path),
};

contextBridge.exposeInMainWorld('spacedemo', api);

// Start with the right look before anything is drawn (the app passes it on the command line of this window).
const startTheme = process.argv.find((a) => a.startsWith('--spacedemo-theme='))?.split('=')[1];
document.documentElement.dataset.theme = startTheme === 'light' ? 'light' : 'dark';
