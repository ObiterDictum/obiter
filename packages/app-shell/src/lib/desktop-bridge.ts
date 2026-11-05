import type { AppPlatform } from '@obiter/contracts'

export interface DesktopBridge {
  platform: 'desktop'
  osPlatform: string
  shellVersion: string
  apiOrigin: string | null
  getAuthToken(): Promise<string | null>
  setAuthToken(token: string): Promise<void>
  clearAuthToken(): Promise<void>
  onUpdateReady(listener: () => void): () => void
  restartToUpdate(): Promise<void>
}

export function readDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  // SAFETY: window.obiterDesktop is set only by the desktop preload (apps/desktop/src/preload) matching DesktopBridge; web and SSR have no bridge, so the read is undefined and returned as-is.
  const bridge = (
    window as Window &
      typeof globalThis & {
        obiterDesktop?: DesktopBridge
      }
  ).obiterDesktop
  return bridge
}

export function hasDarwinWindowControls(platform: AppPlatform): boolean {
  if (platform !== 'desktop') return false
  return readDesktopBridge()?.osPlatform === 'darwin'
}
