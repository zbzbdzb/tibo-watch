import { contextBridge, ipcRenderer } from 'electron';

import type { AppSnapshot, SettingsUpdate, TiboWatchApi } from '../shared/api';

const api: TiboWatchApi = {
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot') as Promise<AppSnapshot>,
  updateSettings: (update: SettingsUpdate) => ipcRenderer.invoke('app:update-settings', update) as Promise<AppSnapshot>,
  checkNow: () => ipcRenderer.invoke('app:check-now') as Promise<AppSnapshot>,
  setPaused: (paused: boolean) => ipcRenderer.invoke('app:set-paused', paused) as Promise<AppSnapshot>,
  openXLogin: () => ipcRenderer.invoke('app:open-x-login') as Promise<AppSnapshot>,
  logoutX: () => ipcRenderer.invoke('app:logout-x') as Promise<AppSnapshot>,
  sendTestEmail: () => ipcRenderer.invoke('app:test-email') as Promise<{ ok: boolean; errorCode: string | null }>,
  openPost: (url: string) => ipcRenderer.invoke('app:open-post', url) as Promise<void>,
  completeOnboarding: () => ipcRenderer.invoke('app:complete-onboarding') as Promise<AppSnapshot>,
  retryMail: (id: string) => ipcRenderer.invoke('app:retry-mail', id) as Promise<AppSnapshot>,
  windowAction: (action) => ipcRenderer.invoke('window:action', action) as Promise<void>,
  onSnapshot: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on('app:snapshot', wrapped);
    return () => ipcRenderer.removeListener('app:snapshot', wrapped);
  },
  onNavigatePost: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, postId: string) => listener(postId);
    ipcRenderer.on('app:navigate-post', wrapped);
    return () => ipcRenderer.removeListener('app:navigate-post', wrapped);
  },
};

contextBridge.exposeInMainWorld('tiboWatch', Object.freeze(api));
