// The only bridge between the window and the app: a fixed list of named calls (see app/shared/api.ts).
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type AiModelState, type SpeechModelState, type TranscriptState, type FixBatchState, type LibraryState, type PlayersView, type SpaceDemoApi, type ThemeChoice, type ThemeState, type UpdateState, type WatchProgress } from '../shared/api.js';

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
  onOpenDemo: (listener: (path: string) => void) => {
    const handler = (_event: unknown, path: string) => listener(path);
    ipcRenderer.on(IPC.openDemo, handler);
    return () => { ipcRenderer.removeListener(IPC.openDemo, handler); };
  },
  takeOpenDemo: () => ipcRenderer.invoke(IPC.takeOpenDemo),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  showInFolder: (path: string) => ipcRenderer.invoke(IPC.showInFolder, path),
  getDemoDetails: (key: string) => ipcRenderer.invoke(IPC.demoDetails, key),
  getReplay: (key: string, round: number, combined?: boolean) => ipcRenderer.invoke(IPC.demoReplay, key, round, combined === true),
  getCombined: (key: string) => ipcRenderer.invoke(IPC.demoCombined, key),
  getPlayers: () => ipcRenderer.invoke(IPC.playersGet),
  onPlayersChanged: (listener: (view: PlayersView) => void) => {
    const handler = (_event: unknown, view: PlayersView) => listener(view);
    ipcRenderer.on(IPC.playersChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.playersChanged, handler); };
  },
  mergePlayers: (alias: string, into: string) => ipcRenderer.invoke(IPC.playersMerge, alias, into),
  unmergePlayer: (alias: string) => ipcRenderer.invoke(IPC.playersUnmerge, alias),
  rejectPlayerSuggestion: (a: string, b: string) => ipcRenderer.invoke(IPC.playersReject, a, b),
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
  openLicence: (which: 'notices' | 'licence') => ipcRenderer.invoke(IPC.openLicence, which),
  getUpdate: () => ipcRenderer.invoke(IPC.updateGet),
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  setUpdateCheck: (on: boolean) => ipcRenderer.invoke(IPC.updateCheckSet, on),
  onUpdate: (listener: (s: UpdateState) => void) => {
    const handler = (_event: unknown, s: UpdateState) => listener(s);
    ipcRenderer.on(IPC.updateChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.updateChanged, handler); };
  },
  chooseGameFolder: (path?: string) => ipcRenderer.invoke(IPC.gameFolderChoose, path),
  clearGameFolder: () => ipcRenderer.invoke(IPC.gameFolderClear),
  setVoiceCleanup: (on: boolean) => ipcRenderer.invoke(IPC.voiceCleanupSet, on),
  setCpuCores: (cores: number | null) => ipcRenderer.invoke(IPC.cpuCoresSet, cores),
  setAiVoice: (on: boolean) => ipcRenderer.invoke(IPC.aiVoiceSet, on),
  getAiModel: () => ipcRenderer.invoke(IPC.aiModelGet),
  downloadAiModel: () => ipcRenderer.invoke(IPC.aiModelDownload),
  chooseAiModel: (path?: string) => ipcRenderer.invoke(IPC.aiModelChoose, path),
  onAiModel: (listener: (s: AiModelState) => void) => {
    const handler = (_event: unknown, s: AiModelState) => listener(s);
    ipcRenderer.on(IPC.aiModelChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.aiModelChanged, handler); };
  },
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  addMapFolder: (path?: string) => ipcRenderer.invoke(IPC.mapFolderAdd, path),
  removeMapFolder: (path: string) => ipcRenderer.invoke(IPC.mapFolderRemove, path),
  getSpeechModel: () => ipcRenderer.invoke(IPC.speechModelGet),
  downloadSpeechModel: () => ipcRenderer.invoke(IPC.speechModelDownload),
  chooseSpeechModel: (path?: string) => ipcRenderer.invoke(IPC.speechModelChoose, path),
  onSpeechModel: (listener: (s: SpeechModelState) => void) => {
    const handler = (_event: unknown, s: SpeechModelState) => listener(s);
    ipcRenderer.on(IPC.speechModelChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.speechModelChanged, handler); };
  },
  getTranscript: (key: string) => ipcRenderer.invoke(IPC.transcriptGet, key),
  startTranscript: (key: string) => ipcRenderer.invoke(IPC.transcriptStart, key),
  stopTranscript: () => ipcRenderer.invoke(IPC.transcriptStop),
  onTranscript: (listener: (s: TranscriptState) => void) => {
    const handler = (_event: unknown, s: TranscriptState) => listener(s);
    ipcRenderer.on(IPC.transcriptChanged, handler);
    return () => { ipcRenderer.removeListener(IPC.transcriptChanged, handler); };
  },
};

contextBridge.exposeInMainWorld('spacedemo', api);

// Start with the right look before anything is drawn (the app passes it on the command line of this window).
const startTheme = process.argv.find((a) => a.startsWith('--spacedemo-theme='))?.split('=')[1];
const look = startTheme === 'light' ? 'light' : 'dark';
// The document can still be empty when the preload runs (seen in the installed build): then set it as soon as it exists.
if (document.documentElement) document.documentElement.dataset.theme = look;
else document.addEventListener('readystatechange', () => { if (document.documentElement && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = look; }, { once: true });
