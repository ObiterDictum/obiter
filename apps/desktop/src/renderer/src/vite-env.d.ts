/// <reference types="vite/client" />

declare const __PACKAGED_API_ORIGIN_DEFAULT__: string

interface Window {
  obiterDesktop?: {
    errorReporting?: { dsn?: string; release?: string; production?: boolean }
    onMainError?(listener: () => void): () => void
    platform: 'desktop'
    shellVersion: string
    apiOrigin: string | null
    getAuthToken(): Promise<string | null>
    setAuthToken(token: string): Promise<void>
    clearAuthToken(): Promise<void>
    onUpdateReady(listener: () => void): () => void
    restartToUpdate(): Promise<void>
  }
}
