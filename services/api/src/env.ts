import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const requiredProductionKeys = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'OBITER_WEB_ORIGIN',
  'OBITER_RESEND_API_KEY',
  'MEILISEARCH_HOST',
  'MEILISEARCH_SEARCH_API_KEY',
  'MEILISEARCH_ADMIN_API_KEY',
] as const

let localEnvLoaded = false

const requiredTestKeys = ['TEST_DATABASE_URL'] as const

export interface ApiEnv {
  databaseUrl: string
  authSecret: string
  authBaseUrl: string
  webOrigin: string
  marketingOrigin: string | null
  desktopOrigin: string
  resendApiKey: string | null
  emailFrom: string
  meilisearchHost: string
  meilisearchSearchApiKey: string
  meilisearchAdminApiKey: string
  legalAuthoritiesIndex: string
  mojFindCaseLawBaseUrl: string
  mojFindCaseLawRateLimit: number
  port: number
  nodeEnv: 'development' | 'test' | 'production'
}

function readNodeEnv(): ApiEnv['nodeEnv'] {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return process.env.NODE_ENV
  }

  return 'development'
}

function requireProductionEnv(nodeEnv: ApiEnv['nodeEnv']) {
  if (nodeEnv !== 'production') {
    return
  }

  const missing: string[] = requiredProductionKeys.filter((key) => !process.env[key])
  if (!process.env.LEGAL_AUTHORITIES_INDEX) {
    missing.push('LEGAL_AUTHORITIES_INDEX')
  }

  if (missing.length > 0) {
    throw new Error(`Missing required production environment values: ${missing.join(', ')}`)
  }
}

function requireTestEnv(nodeEnv: ApiEnv['nodeEnv']) {
  if (nodeEnv !== 'test') {
    return
  }

  const missing = requiredTestKeys.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required test environment values: ${missing.join(', ')}`)
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

function readDatabaseUrl(nodeEnv: ApiEnv['nodeEnv']) {
  if (nodeEnv !== 'test') {
    return readRequiredUrl(
      'DATABASE_URL',
      'postgres://obiter:obiter@localhost:5432/obiter',
    )
  }

  const testDatabaseUrl = parseUrl('TEST_DATABASE_URL', process.env.TEST_DATABASE_URL ?? '')
  const productionDatabaseUrl = process.env.DATABASE_URL
    ? parseUrl('DATABASE_URL', process.env.DATABASE_URL)
    : null

  if (productionDatabaseUrl === testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL must not match DATABASE_URL.')
  }

  return testDatabaseUrl
}

function readOptionalUrl(key: string): string | null {
  const value = process.env[key]

  if (!value) {
    return null
  }

  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`${key} must be a valid URL.`)
  }
}

function readSecret(key: string, fallback: string, nodeEnv: ApiEnv['nodeEnv']) {
  const value = process.env[key] ?? fallback
  const trimmed = value.trim()

  if (trimmed.length !== value.length || trimmed.length === 0) {
    throw new Error(`${key} must not be blank or padded with whitespace.`)
  }

  if (nodeEnv === 'production' && trimmed.length < 32) {
    throw new Error(`${key} must be at least 32 characters in production.`)
  }

  return trimmed
}

function readSearchApiKey(nodeEnv: ApiEnv['nodeEnv']) {
  const fallback = nodeEnv === 'production' ? '' : 'dev-key'

  return readSecret('MEILISEARCH_SEARCH_API_KEY', fallback, nodeEnv)
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

function readLegalAuthoritiesIndexName() {
  return readIndexName('LEGAL_AUTHORITIES_INDEX', 'legal_authorities')
}

function readOptionalSecret(key: string, nodeEnv: ApiEnv['nodeEnv']) {
  const value = process.env[key]

  if (!value) {
    return null
  }

  return readSecret(key, value, nodeEnv)
}

function readPort() {
  const rawPort = process.env.PORT ?? '8787'
  const port = Number(rawPort)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }

  return port
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

function readAdminApiKey(nodeEnv: ApiEnv['nodeEnv']) {
  const fallback = nodeEnv === 'production' ? '' : 'dev-key'

  return readSecret('MEILISEARCH_ADMIN_API_KEY', fallback, nodeEnv)
}

function readPositiveInteger(key: string, fallback: string) {
  const value = process.env[key] ?? fallback
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer.`)
  }

  return parsed
}

export function readApiEnv(): ApiEnv {
  loadLocalDotEnv()
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)
  requireTestEnv(nodeEnv)
  const resendApiKey = readOptionalSecret('OBITER_RESEND_API_KEY', nodeEnv)

  if (nodeEnv === 'production' && !resendApiKey) {
    throw new Error('OBITER_RESEND_API_KEY must be configured in production.')
  }

  const webOrigin = readRequiredUrl('OBITER_WEB_ORIGIN', 'http://localhost:3000')

  return {
    databaseUrl: readDatabaseUrl(nodeEnv),
    authSecret: readSecret(
      'BETTER_AUTH_SECRET',
      'dev-only-better-auth-secret',
      nodeEnv,
    ),
    authBaseUrl: readRequiredUrl(
      'BETTER_AUTH_URL',
      nodeEnv === 'development' ? webOrigin : 'http://localhost:8787',
    ),
    webOrigin,
    marketingOrigin: readOptionalUrl('OBITER_MARKETING_ORIGIN'),
    desktopOrigin: readRequiredUrl(
      'OBITER_DESKTOP_ORIGIN',
      'obiter://desktop-auth',
    ),
    resendApiKey,
    emailFrom: (process.env.OBITER_EMAIL_FROM ?? 'onboarding@resend.dev').trim(),
    meilisearchHost: readRequiredUrl('MEILISEARCH_HOST', 'http://localhost:7700'),
    meilisearchSearchApiKey: readSearchApiKey(nodeEnv),
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
    port: readPort(),
    nodeEnv,
  }
}
