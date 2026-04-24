import { afterEach, describe, expect, it } from 'vitest'
import { readApiEnv } from './env'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('readApiEnv', () => {
  it('uses local development defaults without production secrets', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET

    const env = readApiEnv()

    expect(env.databaseUrl).toContain('localhost')
    expect(env.authSecret).toBe('dev-only-better-auth-secret')
    expect(env.nodeEnv).toBe('development')
  })

  it('fails loudly when production auth and database values are missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_URL
    delete process.env.ORMONT_WEB_ORIGIN

    expect(() => readApiEnv()).toThrow('Missing required production environment values')
  })
})
