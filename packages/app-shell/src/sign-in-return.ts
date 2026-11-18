const PROBE_ORIGIN = 'https://return.invalid'

function isAuthPath(pathname: string): boolean {
  return (
    pathname === '/sign-in' ||
    pathname === '/sign-up' ||
    pathname === '/request-access' ||
    pathname.startsWith('/request-access/') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/invites/accept'
  )
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\') || hasControlCharacter(value)) return null
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const pathname = decoded.toLowerCase().replace(/\/+$/, '') || '/'
  if (pathname === '/' || isAuthPath(pathname)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function returnToCallbackURL(
  returnTo: string | null,
): string | undefined {
  if (!returnTo || typeof window === 'undefined') return undefined
  if (!/^https?:$/.test(window.location.protocol)) return undefined
  return `${window.location.origin}${returnTo}`
}
