import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('obiterDesktop', {
  platform: 'desktop' as const,
  shellVersion: 'phase-0.1',
})
