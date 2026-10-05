/*
 * HTTP response policy for the production web host: content-coding negotiation
 * (RFC 9110 §12.5.3), cache directives, and header merging.
 *
 * Kept apart from serve.mjs, which owns the Node http.Server host, so these
 * rules are unit-testable without a socket and the host file stays scannable.
 */

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

// Text-like assets that compress well. Fonts are already compressed; images
// are not worth the CPU here.
export const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
])

export const GZIP = 'gzip'
const IDENTITY = 'identity'

/**
 * Parse one RFC 9110 qvalue. Only `0`..`1` with at most three decimals is
 * valid. Malformed input is treated as `0` (refusal): we cannot prove the
 * client will decode the coding, and sending an encoding it rejects is worse
 * than sending identity. That is the documented conservative policy.
 */
function parseQvalue(raw) {
  return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0
}

/**
 * Negotiate the response content coding from an Accept-Encoding field value.
 * Returns which of gzip and identity the client accepts; both false means no
 * available representation is acceptable and the request must be answered 406.
 *
 * Token and parameter names are case-insensitive and may be surrounded by
 * whitespace. A coding not listed is unacceptable unless a wildcard makes it
 * acceptable, and `*;q=0` excludes identity too unless it is named explicitly.
 * An absent field expresses no preference, and we serve identity rather than
 * compressing without an explicit request; an empty field means no content
 * coding is wanted.
 */
export function negotiateEncoding(header) {
  if (header === undefined || header === null)
    return { gzip: false, identity: true }
  if (typeof header !== 'string') return { gzip: false, identity: true }
  if (header.trim() === '') return { gzip: false, identity: true }

  let wildcard
  const explicit = new Map()
  for (const element of header.split(',')) {
    const [tokenPart, ...params] = element.split(';')
    const token = tokenPart.trim().toLowerCase()
    if (token === '') continue
    let q = 1
    for (const param of params) {
      const eq = param.indexOf('=')
      if (eq === -1) continue
      if (param.slice(0, eq).trim().toLowerCase() !== 'q') continue
      q = parseQvalue(param.slice(eq + 1).trim())
    }
    if (token === '*') {
      if (wildcard === undefined) wildcard = q
      continue
    }
    // A repeated coding keeps its first, most specific q.
    if (!explicit.has(token)) explicit.set(token, q)
  }

  const gzipQ = explicit.has(GZIP) ? explicit.get(GZIP) : (wildcard ?? 0)
  const identityQ = explicit.has(IDENTITY)
    ? explicit.get(IDENTITY)
    : wildcard === 0
      ? 0
      : 1
  return { gzip: gzipQ > 0, identity: identityQ > 0 }
}

/** True when the client will accept a gzip-coded response. */
export function acceptsGzip(header) {
  return negotiateEncoding(header).gzip
}

/**
 * Cache directive for a served file. `hashed` is whether the build emitted the
 * file with a content hash, which is what makes an immutable directive honest.
 */
export function cacheControlFor(hashed) {
  return hashed ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL
}

/**
 * Union two Vary field values, case-insensitively, preserving order. Used so a
 * handler-supplied `Vary` is extended rather than replaced.
 */
export function mergeVary(existing, incoming) {
  const tokens = []
  for (const source of [existing, incoming]) {
    if (!source) continue
    for (const token of String(source).split(',')) {
      const trimmed = token.trim()
      if (!trimmed) continue
      if (!tokens.some((t) => t.toLowerCase() === trimmed.toLowerCase()))
        tokens.push(trimmed)
    }
  }
  return tokens.join(', ')
}

const CACHE_RANK = [
  ['no-store', 3],
  ['no-cache', 2],
  ['private', 1],
]

/** How restrictive a Cache-Control value is; higher never gets weakened. */
export function cacheControlRank(value) {
  const lower = String(value ?? '').toLowerCase()
  return CACHE_RANK.reduce(
    (rank, [directive, weight]) =>
      lower.includes(directive) ? Math.max(rank, weight) : rank,
    0,
  )
}

/** Pick the more restrictive of two Cache-Control values. */
export function strictestCacheControl(existing, incoming) {
  if (!existing) return incoming
  return cacheControlRank(existing) > cacheControlRank(incoming)
    ? existing
    : incoming
}
