import { contextBridge, ipcRenderer } from 'electron'

/**
 * Resolve the packaged API origin once at preload eval, before the renderer
 * module graph runs. `apiUrl()` and the better-auth client baseURL are both
 * synchronous, so the origin must be a plain property — not an async IPC
 * round-trip. The main process answers via event.returnValue (ipcMain.on).
 *
 * In dev-desktop this resolves to the build-time default (or OBITER_API_ORIGIN
 * if set), but the renderer dev server proxies /api so the value is unused
 * there; dev-desktop keeps using relative /api paths through the proxy.
 */
const apiOrigin = ipcRenderer.sendSync('obiter:get-api-origin') as string | null

contextBridge.exposeInMainWorld('obiterDesktop', {
  platform: 'desktop' as const,
  shellVersion: 'phase-0.1',
  apiOrigin,
})
