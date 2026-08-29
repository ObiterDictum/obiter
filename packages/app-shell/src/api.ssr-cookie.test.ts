// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api'
import {
  clearServerRequestGetter,
  setServerRequestGetter,
} from './lib/server-request'

function mockOkResponse(body: unknown = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as Response
}

describe('apiFetch SSR cookie forwarding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearServerRequestGetter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearServerRequestGetter()
    vi.unstubAllGlobals()
  })

  it('forwards Cookie header during SSR when request has cookie', async () => {
    // Simulate SSR: window is undefined
    vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis)
    // Also ensure globalThis.window is undefined for typeof check
    // @ts-ignore — delete to make typeof window === "undefined"
    if (typeof globalThis.window !== 'undefined') {
      // @ts-ignore
      delete (globalThis as unknown as { window?: unknown }).window
    }

    const req = new Request('http://localhost:3000/settings', {
      headers: { cookie: 'better-auth.session_token=abc123' },
    })
    setServerRequestGetter(() => req)

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockOkResponse({ user: { id: 'usr_1' } }))

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('Cookie')).toBe('better-auth.session_token=abc123')
  })

  it('does not silently swallow unexpected getRequest failures', async () => {
    vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis)
    // @ts-ignore
    if (typeof globalThis.window !== 'undefined') {
      // @ts-ignore
      delete (globalThis as unknown as { window?: unknown }).window
    }

    setServerRequestGetter(() => {
      throw new Error('Unexpected DB failure')
    })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockOkResponse({}))

    await expect(apiFetch('/api/me')).rejects.toThrow('Unexpected DB failure')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('silently handles expected No StartEvent case', async () => {
    vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis)
    // @ts-ignore
    if (typeof globalThis.window !== 'undefined') {
      // @ts-ignore
      delete (globalThis as unknown as { window?: unknown }).window
    }

    setServerRequestGetter(() => {
      throw new Error(
        'No StartEvent found in AsyncLocalStorage. Make sure you are using the function within the server runtime.',
      )
    })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockOkResponse({}))

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('Cookie')).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not forward cookie on client even if getter is set', async () => {
    // window is defined (jsdom) — client, no stub
    const req = new Request('http://localhost:3000/', {
      headers: { cookie: 'better-auth.session_token=should-not-forward' },
    })
    setServerRequestGetter(() => req)

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockOkResponse({}))

    await apiFetch('/api/me')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('Cookie')).toBeNull()
  })
})
