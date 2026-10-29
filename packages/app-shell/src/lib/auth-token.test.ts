import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'

let moduleGen = 0

const bridge = {
  platform: 'desktop' as const,
  shellVersion: 'test',
  apiOrigin: null,
  getAuthToken: vi.fn<() => Promise<string | null>>(),
  setAuthToken: vi.fn<(token: string) => Promise<void>>(),
  clearAuthToken: vi.fn<() => Promise<void>>(),
}

afterEach(() => {
  moduleGen++
  vi.clearAllMocks()
  delete (window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop
})

async function loadTokenModule() {
  return import(`./auth-token?gen=${moduleGen}`)
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

    await expect(getDesktopAuthToken()).resolves.toBeNull()
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
    await expect(getDesktopAuthToken()).resolves.toBeNull()
    expect(bridge.setAuthToken).toHaveBeenCalledWith('token_123')
  })

  it('clears memory and reconciliation after clearDesktopAuthToken IPC rejects, and propagates', async () => {
    bridge.getAuthToken
      .mockResolvedValueOnce('token_123')
      .mockResolvedValueOnce('token_123')
    bridge.clearAuthToken.mockRejectedValue(new Error('clear failed'))
    ;(window as Window & { obiterDesktop?: typeof bridge }).obiterDesktop =
      bridge
    const { getDesktopAuthToken, clearDesktopAuthToken } =
      await loadTokenModule()

    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
    await expect(clearDesktopAuthToken()).rejects.toThrow('clear failed')
    await expect(getDesktopAuthToken()).resolves.toBe('token_123')
  })

  it('a stale load resolving after a newer set does not overwrite the set value', async () => {
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
    await setDesktopAuthToken('token_authoritative')
    resolveLoad('token_stale')
    await firstRead

    await expect(getDesktopAuthToken()).resolves.toBe('token_authoritative')
  })
})
