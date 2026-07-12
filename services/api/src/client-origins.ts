import type { ApiEnv } from './env'

/**
 * Origins of product clients that may call this API (CORS + better-auth CSRF).
 * `authBaseUrl` is included for CORS; better-auth also trusts its own baseURL.
 */
export function configuredClientOrigins(env: ApiEnv): string[] {
  return [env.webOrigin, env.authBaseUrl, env.desktopOrigin, env.marketingOrigin].filter(
    (origin): origin is string => Boolean(origin),
  )
}

/**
 * Electron `pnpm dev:desktop` loads the renderer from electron-vite
 * (default http://localhost:5173, next free port if taken). That Origin reaches
 * the API via the renderer /api proxy and must be trusted in development.
 */
export function isDevDesktopRendererOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false
    }
    // Vite / electron-vite default range; avoid trusting arbitrary local ports.
    const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
    return Number.isInteger(port) && port >= 5173 && port <= 5199
  } catch {
    return false
  }
}

/**
 * better-auth `trustedOrigins` (supports `*` wildcards). Includes configured
 * clients plus loopback Vite ports in development for the desktop renderer.
 */
export function authTrustedOrigins(env: ApiEnv): string[] {
  const origins = configuredClientOrigins(env)
  if (env.nodeEnv === 'development') {
    // Port may bump when 5173 is busy; wildcard matches electron-vite's range.
    origins.push('http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175')
    origins.push('http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175')
    origins.push('http://localhost:*', 'http://127.0.0.1:*')
  }
  return [...new Set(origins)]
}

/**
 * Hono CORS `origin` option: exact allowlist, plus loopback Vite renderer
 * Origins in development (credentials require reflecting the request Origin).
 */
export function corsAllowedOrigin(
  env: ApiEnv,
  requestOrigin: string,
): string | undefined {
  if (configuredClientOrigins(env).includes(requestOrigin)) {
    return requestOrigin
  }
  if (env.nodeEnv === 'development' && isDevDesktopRendererOrigin(requestOrigin)) {
    return requestOrigin
  }
  return undefined
}
