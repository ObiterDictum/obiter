const requiredProductionKeys = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'ORMONT_WEB_ORIGIN',
  'ORMONT_MAGIC_LINK_WEBHOOK_URL',
  'ORMONT_MAGIC_LINK_WEBHOOK_SECRET',
] as const

export interface ApiEnv {
  databaseUrl: string
  authSecret: string
  authBaseUrl: string
  webOrigin: string
  desktopOrigin: string
  magicLinkWebhookUrl: string | null
  magicLinkWebhookSecret: string | null
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

  const missing = requiredProductionKeys.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required production environment values: ${missing.join(', ')}`)
  }
}

function readRequiredUrl(key: string, fallback: string): string {
  const value = process.env[key] ?? fallback

  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${key} must be a valid URL.`)
  }
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

export function readApiEnv(): ApiEnv {
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)
  const magicLinkWebhookUrl = readOptionalUrl('ORMONT_MAGIC_LINK_WEBHOOK_URL')
  const magicLinkWebhookSecret = readOptionalSecret(
    'ORMONT_MAGIC_LINK_WEBHOOK_SECRET',
    nodeEnv,
  )

  if (nodeEnv === 'production' && !magicLinkWebhookUrl) {
    throw new Error('ORMONT_MAGIC_LINK_WEBHOOK_URL must be configured in production.')
  }

  return {
    databaseUrl: readRequiredUrl(
      'DATABASE_URL',
      'postgres://ormont:ormont@localhost:5432/ormont',
    ),
    authSecret: readSecret(
      'BETTER_AUTH_SECRET',
      'dev-only-better-auth-secret',
      nodeEnv,
    ),
    authBaseUrl: readRequiredUrl('BETTER_AUTH_URL', 'http://localhost:8787'),
    webOrigin: readRequiredUrl('ORMONT_WEB_ORIGIN', 'http://localhost:3000'),
    desktopOrigin: readRequiredUrl(
      'ORMONT_DESKTOP_ORIGIN',
      'ormont://desktop-auth',
    ),
    magicLinkWebhookUrl,
    magicLinkWebhookSecret,
    port: readPort(),
    nodeEnv,
  }
}
