import { loadLocalEnvFile, readNodeEnv, type NodeEnv } from '@obiter/config'

const requiredProductionKeys = [
  'MEILISEARCH_HOST',
  'MEILISEARCH_ADMIN_API_KEY',
] as const

export interface LegalIngestorEnv {
  meilisearchHost: string
  meilisearchAdminApiKey: string
  legalAuthoritiesIndex: string
  mojFindCaseLawBaseUrl: string
  mojFindCaseLawRateLimit: number
  databaseUrl: string
  nodeEnv: NodeEnv
}

function requireProductionEnv(nodeEnv: LegalIngestorEnv['nodeEnv']) {
  if (nodeEnv !== 'production') {
    return
  }

  const missing: string[] = requiredProductionKeys.filter(
    (key) => !process.env[key],
  )
  if (!process.env.LEGAL_AUTHORITIES_INDEX) {
    missing.push('LEGAL_AUTHORITIES_INDEX')
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment values: ${missing.join(', ')}`,
    )
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

function readSecret(
  key: string,
  fallback: string,
  nodeEnv: LegalIngestorEnv['nodeEnv'],
) {
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

// `dev-key` is a working local placeholder, so it is reachable only in
// development. An ingest run that reaches a real Meilisearch must name its key.
// A missing key anywhere else fails at startup rather than writing with a
// default credential.
function readAdminApiKey(nodeEnv: LegalIngestorEnv['nodeEnv']) {
  if (nodeEnv === 'development') {
    return readSecret('MEILISEARCH_ADMIN_API_KEY', 'dev-key', nodeEnv)
  }

  const value = process.env.MEILISEARCH_ADMIN_API_KEY
  if (!value) {
    throw new Error('MEILISEARCH_ADMIN_API_KEY must be configured.')
  }

  return readSecret('MEILISEARCH_ADMIN_API_KEY', value, nodeEnv)
}

function readIndexName(key: string, fallback: string) {
  const value = process.env[key] ?? fallback
  const trimmed = value.trim()

  if (trimmed.length !== value.length || trimmed.length === 0) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `${key} may only contain letters, numbers, underscores, and hyphens.`,
    )
  }

  return trimmed
}

// Fixture default: the sample seeder must never write the product index,
// which the rebuild owns. runBoundedSampleIndexing refuses it outright.
function readLegalAuthoritiesIndexName() {
  return readIndexName('LEGAL_AUTHORITIES_INDEX', 'legal_authorities_fixtures')
}

function readPositiveInteger(key: string, fallback: string) {
  const value = process.env[key] ?? fallback
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer.`)
  }

  return parsed
}

export function readLegalIngestorEnv(): LegalIngestorEnv {
  loadLocalEnvFile()
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)

  return {
    meilisearchHost: readRequiredUrl(
      'MEILISEARCH_HOST',
      'http://localhost:7700',
    ),
    meilisearchAdminApiKey: readAdminApiKey(nodeEnv),
    legalAuthoritiesIndex: readLegalAuthoritiesIndexName(),
    mojFindCaseLawBaseUrl: readRequiredUrl(
      'MOJ_FIND_CASE_LAW_BASE_URL',
      'https://caselaw.nationalarchives.gov.uk',
    ),
    mojFindCaseLawRateLimit: readPositiveInteger(
      'MOJ_FIND_CASE_LAW_RATE_LIMIT',
      '1000',
    ),
    databaseUrl: readRequiredUrl(
      'DATABASE_URL',
      'postgres://obiter:obiter@localhost:5432/obiter',
    ),
    nodeEnv,
  }
}
