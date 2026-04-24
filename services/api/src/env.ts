const requiredProductionKeys = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'ORMONT_WEB_ORIGIN',
] as const

export interface ApiEnv {
  databaseUrl: string
  authSecret: string
  authBaseUrl: string
  webOrigin: string
  desktopOrigin: string
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

export function readApiEnv(): ApiEnv {
  const nodeEnv = readNodeEnv()
  requireProductionEnv(nodeEnv)

  return {
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://ormont:ormont@localhost:5432/ormont',
    authSecret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-better-auth-secret',
    authBaseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
    webOrigin: process.env.ORMONT_WEB_ORIGIN ?? 'http://localhost:3000',
    desktopOrigin: process.env.ORMONT_DESKTOP_ORIGIN ?? 'ormont://desktop-auth',
    port: Number(process.env.PORT ?? 8787),
    nodeEnv,
  }
}
