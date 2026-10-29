import { contextBridge, ipcRenderer } from 'electron'

const rawApiOrigin: unknown = ipcRenderer.sendSync('obiter:get-api-origin')
const apiOrigin = typeof rawApiOrigin === 'string' ? rawApiOrigin : null

contextBridge.exposeInMainWorld('obiterDesktop', {
  platform: 'desktop' as const,
  shellVersion: 'phase-0.1',
  apiOrigin,
  getAuthToken: () => ipcRenderer.invoke('obiter:get-auth-token'),
  setAuthToken: (token: string) =>
    ipcRenderer.invoke('obiter:set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('obiter:clear-auth-token'),
})
