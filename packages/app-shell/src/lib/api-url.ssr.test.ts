import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { apiUrl } from './api-url'

const KEYS = ['OBITER_API_ORIGIN', 'BETTER_AUTH_URL'] as const
const original = Object.fromEntries(
  KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof KEYS)[number], string | undefined>

function withoutWindow() {
  vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis)
  if (typeof globalThis.window !== 'undefined') {
    delete (globalThis as { window?: unknown }).window
  }
}

beforeEach(withoutWindow)

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('apiUrl SSR origin precedence', () => {
  it('prefers OBITER_API_ORIGIN over BETTER_AUTH_URL', () => {
    process.env.OBITER_API_ORIGIN = 'http://localhost:8789'
    process.env.BETTER_AUTH_URL = 'http://localhost:3002'

    expect(apiUrl('/api/me')).toBe('http://localhost:8789/api/me')
  })

  it('uses BETTER_AUTH_URL only when OBITER_API_ORIGIN is absent', () => {
    delete process.env.OBITER_API_ORIGIN
    process.env.BETTER_AUTH_URL = 'http://localhost:3002'

    expect(apiUrl('/api/me')).toBe('http://localhost:3002/api/me')
  })

  it('falls back to the shared dev API port when neither is set', () => {
    delete process.env.OBITER_API_ORIGIN
    delete process.env.BETTER_AUTH_URL

    expect(apiUrl('/api/me')).toBe('http://localhost:8787/api/me')
  })
})
