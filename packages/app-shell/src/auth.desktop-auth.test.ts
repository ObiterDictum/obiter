import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock as bunMock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

// Generation bump replaces the old module-registry reset (?gen= query busts
// the cache); the better-auth registrations above persist for the file,
// exactly as the old hoisted mocks did.
let moduleGen = 0

const mock = vi.hoisted(() => ({
  clientOptions: undefined as unknown,
  signOut: vi.fn(),
  useSession: vi.fn(),
}))

bunMock.module('better-auth/react', () => ({
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

bunMock.module('better-auth/client/plugins', () => ({
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
  moduleGen++
  vi.clearAllMocks()
  delete (window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop
})

describe('auth client desktop bearer support', () => {
  it('stores the bearer response header through the desktop bridge', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    bridge.setAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge

    await import(`./auth?gen=${moduleGen}`)

    const fetchOptions = (
      mock.clientOptions as {
        fetchOptions: {
          onSuccess(context: { response: Response }): Promise<void>
        }
      }
    ).fetchOptions
    await fetchOptions.onSuccess({
      response: new Response(null, {
        headers: { 'set-auth-token': 'token_123' },
      }),
    })

    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })
})
