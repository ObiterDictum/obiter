const requiredProductionKeys = [
  'MEILISEARCH_HOST',
  'MEILISEARCH_ADMIN_API_KEY',
  'ATLAS_AUTHORITIES_INDEX',
] as const

export interface AtlasIngestorEnv {
  meilisearchHost: string
  meilisearchAdminApiKey: string
  atlasAuthoritiesIndex: string
  nodeEnv: 'development' | 'test' | 'production'
}

function readNodeEnv(): AtlasIngestorEnv['nodeEnv'] {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return process.env.NODE_ENV
  }

  return 'development'
}

function requireProductionEnv(nodeEnv: AtlasIngestorEnv['nodeEnv']) {
  if (nodeEnv !== 'production') {
    return
  }

  const missing = requiredProductionKeys.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required production environment values: ${missing.join(', ')}`)
  }
}

function parseUrl(key: string, value: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${key} must be a valid URL.`)
  }
}

function readRequiredUrl(key: string, fallback: string): string {
  return parseUrl(key, process.env[key] ?? fallback)
}

function readSecret(key: string, fallback: string, nodeEnv: AtlasIngestorEnv['nodeEnv']) {
  const value = process.env[key] ?? fallback
  const trimmed = value.trim()

  if (trimmed.length !== value.length || trimmed.length === 0) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  if (nodeEnv === 'production' && trimmed.length < 8) {
    throw new Error(`${key} must be at least 8 characters in production.`)
  }

  return trimmed
}

function readAdminApiKey(nodeEnv: AtlasIngestorEnv['nodeEnv']) {
  const fallback =
    nodeEnv === 'production' ? '' : (process.env.MEILISEARCH_API_KEY ?? 'dev-key')

  return readSecret('MEILISEARCH_ADMIN_API_KEY', fallback, nodeEnv)
}

function readIndexName(key: string, fallback: string) {
  const value = process.env[key] ?? fallback
  const trimmed = value.trim()

  if (trimmed.length !== value.length || trimmed.length === 0) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(`${key} may only contain letters, numbers, underscores, and hyphens.`)
  }

  return trimmed
}

export function readAtlasIngestorEnv(): AtlasIngestorEnv {
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)

  return {
    meilisearchHost: readRequiredUrl('MEILISEARCH_HOST', 'http://localhost:7700'),
    meilisearchAdminApiKey: readAdminApiKey(nodeEnv),
    atlasAuthoritiesIndex: readIndexName(
      'ATLAS_AUTHORITIES_INDEX',
      'atlas_authorities',
    ),
    nodeEnv,
  }
}
