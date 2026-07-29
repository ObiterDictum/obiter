import { describe, expect, it } from 'vitest'
import {
  authTrustedOrigins,
  configuredClientOrigins,
  corsAllowedOrigin,
  isAllowedClientOrigin,
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
  rampartModel: 'qarlus/rampart',
  rampartRevision: 'c3221c5cd838eb69a249ab40f8b442483865f233',
  rampartCacheDir: undefined,
  rampartMinScore: 0.4,
  rampartChunkTokens: 400,
  port: 8787,
  nodeEnv: 'development',
}

async function resolveAuthTrustedOrigins(
  env: ApiEnv,
  originHeader?: string,
): Promise<string[]> {
  const configured = authTrustedOrigins(env)
  if (Array.isArray(configured)) {
    return configured
  }
  const headers = new Headers()
  if (originHeader) {
    headers.set('origin', originHeader)
  }
  return configured(
    new Request('http://localhost:8787/api/auth/sign-in/email', { headers }),
  )
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
  it('accepts electron-vite loopback http ports in range', () => {
    expect(isDevDesktopRendererOrigin('http://localhost:5173')).toBe(true)
    expect(isDevDesktopRendererOrigin('http://localhost:5174')).toBe(true)
    expect(isDevDesktopRendererOrigin('http://127.0.0.1:5199')).toBe(true)
  })

  it('rejects https, out-of-range ports, and non-loopback hosts', () => {
    expect(isDevDesktopRendererOrigin('https://localhost:5173')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:3000')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:8787')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:9999')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:5172')).toBe(false)
    expect(isDevDesktopRendererOrigin('http://localhost:5200')).toBe(false)
    expect(isDevDesktopRendererOrigin('https://evil.example')).toBe(false)
    expect(isDevDesktopRendererOrigin('obiter://desktop-auth')).toBe(false)
  })
})

describe('isAllowedClientOrigin — CORS and auth share one gate', () => {
  it('allows configured clients and in-range Vite origins in development', () => {
    expect(isAllowedClientOrigin(baseEnv, 'http://localhost:3000')).toBe(true)
    expect(isAllowedClientOrigin(baseEnv, 'obiter://desktop-auth')).toBe(true)
    expect(isAllowedClientOrigin(baseEnv, 'http://localhost:5173')).toBe(true)
    expect(isAllowedClientOrigin(baseEnv, 'http://127.0.0.1:5199')).toBe(true)
  })

  it('rejects out-of-range ports, https Vite, and non-loopback in development', () => {
    expect(isAllowedClientOrigin(baseEnv, 'http://localhost:9999')).toBe(false)
    expect(isAllowedClientOrigin(baseEnv, 'https://localhost:5173')).toBe(false)
    expect(isAllowedClientOrigin(baseEnv, 'https://evil.example')).toBe(false)
  })

  it('does not allow Vite renderer origins outside development', () => {
    const prod = { ...baseEnv, nodeEnv: 'production' as const }
    expect(isAllowedClientOrigin(prod, 'http://localhost:5173')).toBe(false)
    expect(isAllowedClientOrigin(prod, 'obiter://desktop-auth')).toBe(true)
  })
})

describe('authTrustedOrigins', () => {
  it('trusts in-range Vite Origin via the per-request function in development', async () => {
    const origins = await resolveAuthTrustedOrigins(
      baseEnv,
      'http://localhost:5173',
    )
    expect(origins).toContain('http://localhost:5173')
    expect(origins).toContain('obiter://desktop-auth')
    expect(origins.some((o) => o.includes(':*'))).toBe(false)
  })

  it('does not trust out-of-range or https Vite Origins in development', async () => {
    expect(
      await resolveAuthTrustedOrigins(baseEnv, 'http://localhost:9999'),
    ).not.toContain('http://localhost:9999')
    expect(
      await resolveAuthTrustedOrigins(baseEnv, 'https://localhost:5173'),
    ).not.toContain('https://localhost:5173')
  })

  it('returns only configured clients outside development', async () => {
    const origins = await resolveAuthTrustedOrigins(
      { ...baseEnv, nodeEnv: 'production' },
      'http://localhost:5173',
    )
    expect(origins).not.toContain('http://localhost:5173')
    expect(origins).toContain('obiter://desktop-auth')
    expect(
      Array.isArray(authTrustedOrigins({ ...baseEnv, nodeEnv: 'production' })),
    ).toBe(true)
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

  it('reflects in-range desktop Vite http Origin in development', () => {
    expect(corsAllowedOrigin(baseEnv, 'http://localhost:5173')).toBe(
      'http://localhost:5173',
    )
    expect(corsAllowedOrigin(baseEnv, 'http://127.0.0.1:5199')).toBe(
      'http://127.0.0.1:5199',
    )
  })

  it('rejects out-of-range ports and https Vite Origins (matches auth)', () => {
    expect(corsAllowedOrigin(baseEnv, 'http://localhost:9999')).toBeUndefined()
    expect(corsAllowedOrigin(baseEnv, 'https://localhost:5173')).toBeUndefined()
  })

  it('rejects the desktop Vite origin outside development', () => {
    expect(
      corsAllowedOrigin(
        { ...baseEnv, nodeEnv: 'production' },
        'http://localhost:5173',
      ),
    ).toBeUndefined()
  })

  it('rejects unknown origins', () => {
    expect(corsAllowedOrigin(baseEnv, 'https://evil.example')).toBeUndefined()
  })
})
