import type { ApiEnv } from './env'

const DEV_DESKTOP_RENDERER_PORT_MIN = 5173
const DEV_DESKTOP_RENDERER_PORT_MAX = 5199

export function configuredClientOrigins(env: ApiEnv): string[] {
  return [
    env.webOrigin,
    env.authBaseUrl,
    env.desktopOrigin,
    env.marketingOrigin,
  ].filter((origin): origin is string => Boolean(origin))
}

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

export function isAllowedClientOrigin(env: ApiEnv, origin: string): boolean {
  if (configuredClientOrigins(env).includes(origin)) {
    return true
  }
  return env.nodeEnv === 'development' && isDevDesktopRendererOrigin(origin)
}

export type AuthTrustedOrigins =
  string[] | ((request?: Request) => string[] | Promise<string[]>)

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

export function corsAllowedOrigin(
  env: ApiEnv,
  requestOrigin: string,
): string | undefined {
  return isAllowedClientOrigin(env, requestOrigin) ? requestOrigin : undefined
}
