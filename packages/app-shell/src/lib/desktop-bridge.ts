/**
 * Shape of the Electron preload bridge as seen from the shared app-shell.
 * Constructed in apps/desktop/src/preload; app-shell only reads `apiOrigin`.
 *
 * `apiOrigin` is the absolute API URL the packaged renderer talks to, or null
 * in dev-desktop (where the Vite proxy handles /api). Web and SSR have no
 * bridge at all.
 */
export interface DesktopBridge {
  platform: 'desktop'
  shellVersion: string
  apiOrigin: string | null
}

/**
 * The bridge exposed on `window.obiterDesktop` in the packaged Electron
 * renderer. Optional because app-shell code also runs in the web app and SSR.
 *
 * The property is declared on `Window` by the desktop app's type declarations
 * (apps/desktop/src/renderer/src/vite-env.d.ts); app-shell cannot see that
 * ambient declaration, so the read is cast through a local structural type.
 * The cast is the documented reason this stays sync and package-independent.
 */
export function readDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const bridge = (
    window as Window &
      typeof globalThis & {
        obiterDesktop?: DesktopBridge
      }
  ).obiterDesktop
  return bridge
}
