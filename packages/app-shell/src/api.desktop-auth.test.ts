import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { clearDesktopAuthToken } from './lib/auth-token'

// Generation bump replaces the old module-registry reset: the ?gen= query
// gives each test a freshly evaluated ./api module.
let moduleGen = 0

const bridge = {
  platform: 'desktop' as const,
  shellVersion: 'test',
  apiOrigin: 'http://localhost:8787',
  getAuthToken: vi.fn<() => Promise<string | null>>(),
  setAuthToken: vi.fn<(token: string) => Promise<void>>(),
  clearAuthToken: vi.fn<() => Promise<void>>(),
}

afterEach(async () => {
  // Clear while the bridge is still present: clearDesktopAuthToken returns
  // early without one, and bun has no module-registry reset for the token
  // module's renderer-memory cache.
  await clearDesktopAuthToken()
  vi.restoreAllMocks()
  moduleGen++
  vi.clearAllMocks()
  delete (window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop
})

function response(body: unknown): Response {
  return {
    ok: true,
    headers: new Headers(),
    json: async () => body,
  } as Response
}

describe('apiFetch desktop bearer authentication', () => {
  it('attaches the main-process token while retaining cookie credentials', async () => {
    bridge.getAuthToken.mockResolvedValue('token_123')
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ user: { id: 'usr_1' } }))
    const { apiFetch } = await import(`./api?gen=${moduleGen}`)

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token_123' })
  })

  it('does not add authorization when the desktop token is absent', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({}))
    const { apiFetch } = await import(`./api?gen=${moduleGen}`)

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })
})
