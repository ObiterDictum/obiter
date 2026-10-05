/**
 * SSRF guard for provider-controlled URLs.
 *
 * Feed `rel="next"` hrefs, Atom/HTML document URIs, and stored
 * `source_uri`/`xml_uri` rows are attacker-influenceable: a compromised or
 * intercepted upstream response, or a poisoned row, can point one at an
 * internal address and make the ingester or API issue a blind request to it —
 * and for Find Case Law the body is then persisted and indexed. Every
 * server-side fetch of an upstream-supplied URL resolves it through here
 * first.
 *
 * The resolved URL stays on the configured provider host. Scheme and port are
 * normalised to the base URL's: that keeps the plaintext `http://` links the
 * legislation.gov.uk feeds publish working, fetched over https and never in
 * the clear, and pulls a same-host link naming another port back to the
 * provider's own service rather than refusing it.
 *
 * This checks the URL, not a later redirect target, so callers must fetch with
 * `redirect: 'manual'`. A same-origin URL that 3xxes off-origin is then a
 * failed response, never a followed hop.
 */
export function resolveProviderUrl(
  baseUrl: string,
  candidate: string,
): URL | null {
  let base: URL
  let target: URL
  try {
    base = new URL(baseUrl)
    target = new URL(candidate, base)
  } catch {
    return null
  }

  // Only HTTP(S): `file:`, `ftp:`, `data:` and the like have no place here.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  if (target.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null

  // An explicit port that is not the base's names a different service on the
  // provider host. A default port is fine and is normalised below.
  const basePort = base.port || (base.protocol === 'https:' ? '443' : '80')
  if (target.port !== '' && target.port !== basePort) return null

  // Drop userinfo and force the base origin. A provider link may be plaintext
  // http, but it must never be fetched in the clear or against another host.
  target.username = ''
  target.password = ''
  target.protocol = base.protocol
  target.port = base.port
  return target
}

/**
 * The provider URL a user is shown as a document's official source.
 *
 * `toDocumentUri` is not a security boundary: a protocol-relative
 * `//evil.example/x` passes through it unchanged, and a raw
 * `new URL(uri, base)` then resolves it to the attacker's host. That link is
 * never fetched, so it is not SSRF, but presenting it to a solicitor as the
 * official source of a judgment is a phishing surface. Resolve each candidate
 * through the same guard the fetch sinks use, and fall back to the provider
 * origin, so a feed cannot choose the host the product shows.
 */
export function providerDocumentUrl(
  baseUrl: string,
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = resolveProviderUrl(baseUrl, candidate)
    if (resolved) return resolved.toString()
  }
  return new URL('/', baseUrl).toString()
}
