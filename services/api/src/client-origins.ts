import type { ApiEnv } from './env'

/** electron-vite / Vite default port and the bump range when the default is taken. */
export const DEV_DESKTOP_RENDERER_PORT_MIN = 5173
export const DEV_DESKTOP_RENDERER_PORT_MAX = 5199

/**
 * Origins of product clients that may call this API (CORS + better-auth CSRF).
 * `authBaseUrl` is included for CORS; better-auth also trusts its own baseURL.
 */
export function configuredClientOrigins(env: ApiEnv): string[] {
  return [
    env.webOrigin,
    env.authBaseUrl,
    env.desktopOrigin,
    env.marketingOrigin,
  ].filter((origin): origin is string => Boolean(origin))
}

/**
 * Electron `pnpm dev:desktop` loads the renderer from electron-vite over plain
 * http (default http://localhost:5173, next free port if taken). That Origin
 * reaches the API via the renderer /api proxy and must be trusted in
 * development. https is rejected: electron-vite does not serve TLS in dev, and
 * CORS + better-auth must use the same gate.
 */
export function isDevDesktopRendererOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') {
      return false
    }
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false
    }
    const port = url.port === '' ? 80 : Number(url.port)
    return (
      Number.isInteger(port) &&
      port >= DEV_DESKTOP_RENDERER_PORT_MIN &&
      port <= DEV_DESKTOP_RENDERER_PORT_MAX
    )
  } catch {
    return false
  }
}

/**
 * Single allow decision shared by CORS and better-auth. Configured clients
 * always; in development, also the electron-vite renderer Origin gate.
 *
 * Assumes real deploys set NODE_ENV=production. Unknown or unset NODE_ENV
 * without OBITER_LOCAL_DEVELOPMENT=1 refuses startup (see readNodeEnv).
 */
export function isAllowedClientOrigin(env: ApiEnv, origin: string): boolean {
  if (configuredClientOrigins(env).includes(origin)) {
    return true
  }
  return env.nodeEnv === 'development' && isDevDesktopRendererOrigin(origin)
}

export type AuthTrustedOrigins =
  string[] | ((request?: Request) => string[] | Promise<string[]>)

/**
 * better-auth `trustedOrigins`. Static configured clients outside development;
 * in development a per-request function that adds the request Origin only when
 * it passes `isDevDesktopRendererOrigin` (same gate as CORS — no port wildcards).
 *
 * Assumes real deploys set NODE_ENV=production (see isAllowedClientOrigin).
 */
export function authTrustedOrigins(env: ApiEnv): AuthTrustedOrigins {
  const configured = configuredClientOrigins(env)

  if (env.nodeEnv !== 'development') {
    return configured
  }

  return (request?: Request) => {
    const origins = [...configured]
    const header = request?.headers.get('origin')
    if (header && isDevDesktopRendererOrigin(header)) {
      origins.push(header)
    }
    return origins
  }
}

/**
 * Hono CORS `origin` option: reflect the request Origin when allowed
 * (credentials require an exact match, not `*`).
 *
 * Assumes real deploys set NODE_ENV=production (see isAllowedClientOrigin).
 */
export function corsAllowedOrigin(
  env: ApiEnv,
  requestOrigin: string,
): string | undefined {
  return isAllowedClientOrigin(env, requestOrigin) ? requestOrigin : undefined
}
