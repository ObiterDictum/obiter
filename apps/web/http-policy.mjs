export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

export const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
])

const GZIP = 'gzip'
const IDENTITY = 'identity'

function parseQvalue(raw) {
  return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0
}

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

export function acceptsGzip(header) {
  return negotiateEncoding(header).gzip
}

export function cacheControlFor(hashed) {
  return hashed ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL
}

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

export function cacheControlRank(value) {
  const lower = String(value ?? '').toLowerCase()
  return CACHE_RANK.reduce(
    (rank, [directive, weight]) =>
      lower.includes(directive) ? Math.max(rank, weight) : rank,
    0,
  )
}

export function strictestCacheControl(existing, incoming) {
  if (!existing) return incoming
  return cacheControlRank(existing) > cacheControlRank(incoming)
    ? existing
    : incoming
}
