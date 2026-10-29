import { readDesktopBridge } from './desktop-bridge'

export function resolvePackagedApiOrigin(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const origin = readDesktopBridge()?.apiOrigin
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
