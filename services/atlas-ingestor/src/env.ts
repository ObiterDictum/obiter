import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const requiredProductionKeys = [
  'MEILISEARCH_HOST',
  'MEILISEARCH_ADMIN_API_KEY',
  'ATLAS_AUTHORITIES_INDEX',
] as const

let localEnvLoaded = false

export interface AtlasIngestorEnv {
  meilisearchHost: string
  meilisearchAdminApiKey: string
  atlasAuthoritiesIndex: string
  mojFindCaseLawBaseUrl: string
  mojFindCaseLawRateLimit: number
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

function loadLocalDotEnv() {
  if (localEnvLoaded || process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return
  }

  localEnvLoaded = true
  let directory = process.cwd()

  for (let depth = 0; depth < 5; depth += 1) {
    const envPath = join(directory, '.env')

    if (existsSync(envPath)) {
      for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue

        const separatorIndex = line.indexOf('=')
        if (separatorIndex <= 0) continue

        const key = line.slice(0, separatorIndex).trim()
        const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '')

        process.env[key] ??= value
      }

      return
    }

    const parent = dirname(directory)
    if (parent === directory) return
    directory = parent
  }
}

function readPositiveInteger(key: string, fallback: string) {
  const value = process.env[key] ?? fallback
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer.`)
  }

  return parsed
}

export function readAtlasIngestorEnv(): AtlasIngestorEnv {
  loadLocalDotEnv()
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)

  return {
    meilisearchHost: readRequiredUrl('MEILISEARCH_HOST', 'http://localhost:7700'),
    meilisearchAdminApiKey: readAdminApiKey(nodeEnv),
    atlasAuthoritiesIndex: readIndexName(
      'ATLAS_AUTHORITIES_INDEX',
      'atlas_authorities',
    ),
    mojFindCaseLawBaseUrl: readRequiredUrl(
      'MOJ_FIND_CASE_LAW_BASE_URL',
      'https://caselaw.nationalarchives.gov.uk',
    ),
    mojFindCaseLawRateLimit: readPositiveInteger(
      'MOJ_FIND_CASE_LAW_RATE_LIMIT',
      '1000',
    ),
    nodeEnv,
  }
}
