// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = {
  platform: 'desktop' as const,
  shellVersion: 'test',
  apiOrigin: null,
  getAuthToken: vi.fn<() => Promise<string | null>>(),
  setAuthToken: vi.fn<(token: string) => Promise<void>>(),
  clearAuthToken: vi.fn<() => Promise<void>>(),
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete (window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop
})

async function loadTokenModule() {
  return import('./auth-token')
}

describe('desktop auth token', () => {
  it('loads the bridge token once and retains it in renderer memory', async () => {
    bridge.getAuthToken.mockResolvedValue('token_123')
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop = bridge
    const { getDesktopAuthToken } = await loadTokenModule()

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    await expect(getDesktopAuthToken()).resolves.toBe('token_123')

    expect(bridge.getAuthToken).toHaveBeenCalledOnce()
  })

  it('persists a received token only through the desktop bridge', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    bridge.setAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop = bridge
    const { getDesktopAuthToken, setDesktopAuthToken } = await loadTokenModule()

    await setDesktopAuthToken('token_123')

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })

  it('clears renderer memory and main-process persistence', async () => {
    bridge.getAuthToken.mockResolvedValue('token_123')
    bridge.clearAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop = bridge
    const { clearDesktopAuthToken, getDesktopAuthToken } = await loadTokenModule()

    await getDesktopAuthToken()
    await clearDesktopAuthToken()

    await expect(getDesktopAuthToken()).resolves.toBeNull()
    expect(bridge.clearAuthToken).toHaveBeenCalledOnce()
  })

  it('does not use token state when the desktop bridge is absent', async () => {
    const { getDesktopAuthToken, setDesktopAuthToken } = await loadTokenModule()

    await setDesktopAuthToken('token_123')

    await expect(getDesktopAuthToken()).resolves.toBeNull()
    expect(bridge.setAuthToken).not.toHaveBeenCalled()
  })
})
