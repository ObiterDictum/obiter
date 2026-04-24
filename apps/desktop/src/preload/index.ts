import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('ormontDesktop', {
  platform: 'desktop' as const,
  shellVersion: 'phase-0.1',
})
