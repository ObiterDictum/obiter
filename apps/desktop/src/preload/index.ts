import { contextBridge, ipcRenderer } from 'electron'

const rawApiOrigin: unknown = ipcRenderer.sendSync('obiter:get-api-origin')
const apiOrigin = typeof rawApiOrigin === 'string' ? rawApiOrigin : null

contextBridge.exposeInMainWorld('obiterDesktop', {
  onMainError: (listener: (error: {kind:string,message:string}) => void) => {
    const receive = (_event: unknown, error: {kind:string,message:string}) => listener(error)
    ipcRenderer.on('obiter:main-error',receive)
    return () => {ipcRenderer.removeListener('obiter:main-error',receive)}
  },
  platform: 'desktop'  as const,
  osPlatform: process.platform,
  shellVersion: 'phase-0.1',
  apiOrigin,
  getAuthToken: () => ipcRenderer.invoke('obiter:get-auth-token'),
  setAuthToken: (token: string) =>
    ipcRenderer.invoke('obiter:set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('obiter:clear-auth-token'),
  onUpdateReady: (listener: () => void) => {
    const announce = () => listener()
    ipcRenderer.on('obiter:update-ready', announce)
    void ipcRenderer.invoke('obiter:update-status').then((version: unknown) => {
      if (typeof version === 'string') listener()
    })
    return () => ipcRenderer.removeListener('obiter:update-ready', announce)
  },
  restartToUpdate: () => ipcRenderer.invoke('obiter:restart-to-update'),
})
