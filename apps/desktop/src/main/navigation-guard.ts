/**
 * The allow/deny decision for main-frame navigations in the desktop window.
 * Pure (no Electron) so it can be unit-tested without booting the app.
 *
 * Why this exists and why it must NOT use URL.origin: in the WHATWG URL spec
 * the origin of every non-special scheme (obiter://, file://, anything://) is
 * the literal string "null". A previous guard compared
 * new URL(target).origin === new URL('obiter://desktop-auth').origin, which is
 * "null" === "null" — so in a packaged build a navigation to file:///C:/... or
 * evil://anything matched and was allowed. That loads foreign content into the
 * privileged obiter:// renderer (preload bridge attached, trusted Origin): a
 * full privilege escape.
 *
 * Instead we compare protocol and host explicitly against the parsed allowed
 * origin, and fail closed (deny) when either URL is unparseable or on any
 * non-match.
 */
export interface AllowedOrigin {
  protocol: string
  host: string
}

/**
 * Parse the configured allowed-navigation origin (obiter://desktop-auth in a
 * packaged build, the electron-vite dev URL in dev) into its protocol + host.
 * Returns null if it cannot be parsed — the caller must treat that as
 * "block everything" (fail closed).
 */
export function parseAllowedOrigin(raw: string): AllowedOrigin | null {
  try {
    const parsed = new URL(raw)
    return { protocol: parsed.protocol, host: parsed.host }
  } catch {
    return null
  }
}

/**
 * True only when targetUrl has the same protocol and host as the allowed
 * origin. Any parse failure, mismatch, or absent allowlist denies (returns
 * false) — fail closed, never fail open.
 */
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
