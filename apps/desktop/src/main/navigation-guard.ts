export interface AllowedOrigin {
  protocol: string
  host: string
}

export function parseAllowedOrigin(raw: string): AllowedOrigin | null {
  try {
    const parsed = new URL(raw)
    return { protocol: parsed.protocol, host: parsed.host }
  } catch {
    return null
  }
}

export function isAllowedNavigation(
  allowed: AllowedOrigin | null,
  targetUrl: string,
): boolean {
  if (!allowed) {
    return false
  }

  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  return target.protocol === allowed.protocol && target.host === allowed.host
}

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:'])

export function isSafeExternalUrl(targetUrl: string): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  return EXTERNAL_PROTOCOLS.has(target.protocol) && target.hostname !== ''
}
