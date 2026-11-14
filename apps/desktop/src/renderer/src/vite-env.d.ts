/// <reference types="vite/client" />

declare const __PACKAGED_API_ORIGIN_DEFAULT__: string

interface Window {
  obiterDesktop?: {
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

declare const __OBITER_BUILD_COMMIT__: string
