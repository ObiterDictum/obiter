/**
 * Resolve an API path for the current runtime.
 *
 * Three runtimes, three shapes:
 *
 * - Packaged Electron renderer: the main process owns the absolute API origin
 *   and exposes it on `window.obiterDesktop.apiOrigin` via the preload bridge
 *   (a single sync read at preload eval). When present, paths become absolute
 *   URLs against that origin — the packaged app has no dev-server proxy, so a
 *   relative `/api/...` would have nowhere to go.
 * - Browser (web app or dev-desktop over Vite): no bridge, so relative
 *   `/api/...` is correct — the Vite dev-server proxy (web) or same-origin in
 *   production carries it.
 * - Server (TanStack Start SSR): the API lives at OBITER_API_ORIGIN (falling
 *   back to BETTER_AUTH_URL, then the dev API port).
 */

/**
 * The packaged-renderer API origin exposed by the Electron preload bridge, or
 * null in any non-packaged context (web, SSR, dev-desktop). A sync property
 * read — the preload resolved it once at load time before the renderer module
 * graph runs.
 */
export function resolvePackagedApiOrigin(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const bridge = (window as Window).obiterDesktop
  const origin = bridge?.apiOrigin
  return typeof origin === 'string' && origin.length > 0 ? origin : null
}

export function apiUrl(path: string): string {
  if (typeof window !== 'undefined') {
    const origin = resolvePackagedApiOrigin()
    return origin ? new URL(path, origin).toString() : path
  }

  return new URL(
    path,
    process.env.OBITER_API_ORIGIN ??
      process.env.BETTER_AUTH_URL ??
      'http://localhost:8787',
  ).toString()
}
