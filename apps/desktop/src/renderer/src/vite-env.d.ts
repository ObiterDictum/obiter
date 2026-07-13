/// <reference types="vite/client" />

/**
 * Injected by electron.vite.config.ts `define`. Raw token replacement of a
 * JSON-stringified build-time default for the packaged API origin.
 */
declare const __PACKAGED_API_ORIGIN_DEFAULT__: string

interface Window {
  /**
   * Exposed by the Electron preload bridge (contextIsolation-safe). Always
   * present in the desktop renderer. Optional in the type because app-shell
   * code is shared with the web app and SSR, where the bridge is absent.
   * `apiOrigin` is the absolute API URL the packaged renderer talks to,
   * resolved once by the main process and read synchronously at preload eval.
   */
  obiterDesktop?: {
    platform: 'desktop'
    shellVersion: string
    apiOrigin: string | null
  }
}
