// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = {
  platform: 'desktop' as const,
  shellVersion: 'test',
  apiOrigin: 'http://localhost:8787',
  getAuthToken: vi.fn<() => Promise<string | null>>(),
  setAuthToken: vi.fn<(token: string) => Promise<void>>(),
  clearAuthToken: vi.fn<() => Promise<void>>(),
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
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
    const { apiFetch } = await import('./api')

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
    const { apiFetch } = await import('./api')

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })
})
