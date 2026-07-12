import { describe, expect, it } from 'vitest'
import {
  authTrustedOrigins,
  configuredClientOrigins,
  corsAllowedOrigin,
  isDevDesktopRendererOrigin,
} from './client-origins'
import type { ApiEnv } from './env'

const baseEnv: ApiEnv = {
  databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
  authSecret: 'dev-only-better-auth-secret',
  authBaseUrl: 'http://localhost:8787',
  webOrigin: 'http://localhost:3000',
  marketingOrigin: null,
  desktopOrigin: 'obiter://desktop-auth',
  resendApiKey: null,
  emailFrom: 'onboarding@resend.dev',
  meilisearchHost: 'http://localhost:7700',
  meilisearchSearchApiKey: 'dev-key',
  meilisearchAdminApiKey: 'dev-key',
  legalAuthoritiesIndex: 'legal_authorities',
  mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
  mojFindCaseLawRateLimit: 1000,
  port: 8787,
  nodeEnv: 'development',
}

describe('configuredClientOrigins', () => {
  it('includes web, auth, and desktop origins', () => {
    expect(configuredClientOrigins(baseEnv)).toEqual([
      'http://localhost:3000',
      'http://localhost:8787',
      'obiter://desktop-auth',
    ])
  })

  it('includes marketing when configured', () => {
    expect(
      configuredClientOrigins({
        ...baseEnv,
        marketingOrigin: 'https://obiter.tech',
      }),
    ).toContain('https://obiter.tech')
  })
})

describe('isDevDesktopRendererOrigin', () => {
  it('accepts electron-vite loopback ports', () => {
    expect(isDevDesktopRendererOrigin('http://localhost:5173')).toBe(true)
    expect(isDevDesktopRendererOrigin('http://localhost:5174')).toBe(true)
    expect(isDevDesktopRendererOrigin('http://127.0.0.1:5175')).toBe(true)
  })

  it('rejects non-renderer origins', () => {
    expect(isDevDesktopRendererOrigin('http://localhost:3000')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:8787')).toBe(false)
    expect(isDevDesktopRendererOrigin('https://evil.example')).toBe(false)
    expect(isDevDesktopRendererOrigin('obiter://desktop-auth')).toBe(false)
  })
})

describe('authTrustedOrigins', () => {
  it('adds Vite renderer origins in development', () => {
    const origins = authTrustedOrigins(baseEnv)
    expect(origins).toContain('http://localhost:5173')
    expect(origins).toContain('http://localhost:*')
    expect(origins).toContain('obiter://desktop-auth')
  })

  it('does not add Vite renderer wildcards outside development', () => {
    const origins = authTrustedOrigins({ ...baseEnv, nodeEnv: 'production' })
    expect(origins).not.toContain('http://localhost:5173')
    expect(origins).not.toContain('http://localhost:*')
    expect(origins).toContain('obiter://desktop-auth')
  })
})

describe('corsAllowedOrigin', () => {
  it('reflects configured clients', () => {
    expect(corsAllowedOrigin(baseEnv, 'http://localhost:3000')).toBe(
      'http://localhost:3000',
    )
    expect(corsAllowedOrigin(baseEnv, 'obiter://desktop-auth')).toBe(
      'obiter://desktop-auth',
    )
  })

  it('reflects the desktop Vite origin in development', () => {
    expect(corsAllowedOrigin(baseEnv, 'http://localhost:5173')).toBe(
      'http://localhost:5173',
    )
  })

  it('rejects the desktop Vite origin outside development', () => {
    expect(
      corsAllowedOrigin({ ...baseEnv, nodeEnv: 'production' }, 'http://localhost:5173'),
    ).toBeUndefined()
  })

  it('rejects unknown origins', () => {
    expect(corsAllowedOrigin(baseEnv, 'https://evil.example')).toBeUndefined()
  })
})
