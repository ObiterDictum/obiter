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
