import '@obiter/test-dom'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { apiFetch } from './api'
import {
  clearServerRequestGetter,
  setServerRequestGetter,
} from './lib/server-request'
import { caseLawDocumentQueryOptions } from './views/case-law-document-query'

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
    vi.stubGlobal('window', undefined as unknown as Window & typeof globalThis)
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

  it('uses the signed-in session for server-rendered judgment requests', async () => {
    vi.stubGlobal('window', undefined)
    const req = new Request('http://localhost:3000/case/uksc-2024-3', {
      headers: { cookie: 'better-auth.session_token=test-session' },
    })
    setServerRequestGetter(() => req)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockOkResponse({ document: { id: 'uksc-2024-3' } }))
    const client = new QueryClient()
    await client.fetchQuery(caseLawDocumentQueryOptions('uksc-2024-3'))

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(new URL(String(url)).pathname).toBe(
      '/api/search/documents/uksc-2024-3',
    )
    expect(new Headers(init?.headers).get('cookie')).toBe(
      'better-auth.session_token=test-session',
    )
  })

  it('forwards the edge visitor IP only to the private judgment API', async () => {
    vi.stubGlobal('window', undefined)
    const key = 'OBITER_JUDGMENT_API_ORIGIN'
    const previousOrigin = process.env[key]
    process.env[key] = 'http://obiter-api:8787'
    try {
      setServerRequestGetter(
        () =>
          new Request('https://app.obiter.si/cases/uksc-2024-3', {
            headers: {
              'cf-connecting-ip': '192.0.2.123',
              'x-forwarded-for': '198.51.100.1',
            },
          }),
      )
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockOkResponse({ document: { id: 'uksc-2024-3' } }))

      await new QueryClient().fetchQuery(
        caseLawDocumentQueryOptions('uksc-2024-3'),
      )
      await apiFetch('/api/me')

      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(
        'http://obiter-api:8787/api/search/documents/uksc-2024-3',
      )
      expect(new Headers(init?.headers).get('x-forwarded-for')).toBe(
        '192.0.2.123',
      )
      expect(
        new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has(
          'x-forwarded-for',
        ),
      ).toBe(false)
    } finally {
      if (previousOrigin === undefined) delete process.env[key]
      else process.env[key] = previousOrigin
    }
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
