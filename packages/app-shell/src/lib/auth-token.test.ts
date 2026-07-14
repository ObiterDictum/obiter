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
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken } = await loadTokenModule()

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    await expect(getDesktopAuthToken()).resolves.toBe('token_123')

    expect(bridge.getAuthToken).toHaveBeenCalledOnce()
  })

  it('persists a received token only through the desktop bridge', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    bridge.setAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken, setDesktopAuthToken } = await loadTokenModule()

    await setDesktopAuthToken('token_123')

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })

  it('clears renderer memory and main-process persistence', async () => {
    bridge.getAuthToken.mockResolvedValue('token_123')
    bridge.clearAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { clearDesktopAuthToken, getDesktopAuthToken } =
      await loadTokenModule()

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

  it('does not cache a rejected load forever: a later call retries and succeeds', async () => {
    bridge.getAuthToken
      .mockRejectedValueOnce(new Error('transient IPC failure'))
      .mockResolvedValueOnce('token_later')
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken } = await loadTokenModule()

    // First load fails — must degrade to null, never reject.
    await expect(getDesktopAuthToken()).resolves.toBeNull()
    // Second load retries (loadPromise was reset) and succeeds.
    await expect(getDesktopAuthToken()).resolves.toBe('token_later')
    expect(bridge.getAuthToken).toHaveBeenCalledTimes(2)
  })

  it('does not update memory when setDesktopAuthToken IPC rejects, and propagates', async () => {
    bridge.getAuthToken.mockResolvedValue(null)
    bridge.setAuthToken.mockRejectedValue(new Error('persist failed'))
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken, setDesktopAuthToken } = await loadTokenModule()

    await expect(setDesktopAuthToken('token_123')).rejects.toThrow(
      'persist failed',
    )
    // Memory was not updated: no token claims success after a failed persist.
    await expect(getDesktopAuthToken()).resolves.toBeNull()
    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })

  it('clears memory and reconciliation after clearDesktopAuthToken IPC rejects, and propagates', async () => {
    bridge.getAuthToken
      .mockResolvedValueOnce('token_123')
      .mockResolvedValueOnce('token_123') // reconciled from main after failed clear
    bridge.clearAuthToken.mockRejectedValue(new Error('clear failed'))
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken, clearDesktopAuthToken } =
      await loadTokenModule()

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    // The durable clear failed; the rejection must surface (sign-out stays
    // honest about what is still on disk).
    await expect(clearDesktopAuthToken()).rejects.toThrow('clear failed')
    // loadPromise was reset, so the next read reconciles from main — which
    // still holds the token. The renderer does not look signed out.
    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
  })

  it('a stale load resolving after a newer set does not overwrite the set value', async () => {
    // Hold the load in flight across a set so it resolves with a stale value.
    let resolveLoad: (value: string | null) => void = () => {}
    bridge.getAuthToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve
        }),
    )
    bridge.setAuthToken.mockResolvedValue(undefined)
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken, setDesktopAuthToken } = await loadTokenModule()

    const firstRead = getDesktopAuthToken()
    // While the load is in flight, a set establishes the authoritative value.
    await setDesktopAuthToken('token_authoritative')
    // Now let the stale load resolve with an older value.
    resolveLoad('token_stale')
    await firstRead

    // The revision guard must drop the stale result; memory keeps the set value.
    await expect(getDesktopAuthToken()).resolves.toBe('token_authoritative')
  })
})
