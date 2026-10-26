// The only bridge between the window and the app: a fixed list of named calls (see app/shared/api.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type SpaceDemoApi, type ThemeChoice, type ThemeState } from '../shared/api.js';

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
};

contextBridge.exposeInMainWorld('spacedemo', api);

// Start with the right look before anything is drawn (the app passes it on the command line of this window).
const startTheme = process.argv.find((a) => a.startsWith('--spacedemo-theme='))?.split('=')[1];
document.documentElement.dataset.theme = startTheme === 'light' ? 'light' : 'dark';
