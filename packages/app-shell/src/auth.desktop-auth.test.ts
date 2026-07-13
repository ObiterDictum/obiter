// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  clientOptions: undefined as unknown,
  signOut: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('better-auth/react', () => ({
  createAuthClient: (options: unknown) => {
    mock.clientOptions = options
    return {
      useSession: mock.useSession,
      signIn: { email: vi.fn() },
      signUp: { email: vi.fn() },
      signOut: mock.signOut,
    }
  },
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({}),
}))

const bridge = {
  platform: 'desktop' as const,
  shellVersion: 'test',
  apiOrigin: 'http://localhost:8787',
  getAuthToken: vi.fn<() => Promise<string | null>>(),
  setAuthToken: vi.fn<(token: string) => Promise<void>>(),
  clearAuthToken: vi.fn<() => Promise<void>>(),
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete (window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop
})

describe('auth client desktop bearer support', () => {
  it('stores the bearer response header through the desktop bridge', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    bridge.setAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop = bridge

    await import('./auth')

    const fetchOptions = (mock.clientOptions as {
      fetchOptions: {
        onSuccess(context: { response: Response }): Promise<void>
      }
    }).fetchOptions
    await fetchOptions.onSuccess({
      response: new Response(null, { headers: { 'set-auth-token': 'token_123' } }),
    })

    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })
})
