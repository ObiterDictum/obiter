import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, apiFetchBlobResult } from './api'

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends credentials and returns parsed JSON on success', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse({ matters: [] }))

    const result = await apiFetch<{ matters: unknown[] }>('/api/matters')

    expect(result).toEqual({ matters: [] })
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.credentials).toBe('include')
  })

  it('returns undefined for a 204 success with no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(null, 204))

    await expect(
      apiFetch('/api/documents/doc_1/collaboration/presence', {
        method: 'PUT',
        body: JSON.stringify({ cursor: null }),
      }),
    ).resolves.toBeUndefined()
  })

  it('does not override multipart content type with JSON', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse({ document: {} }))
    const form = new FormData()
    form.set('file', new File(['text'], 'source.txt', { type: 'text/plain' }))

    await apiFetch('/api/redaction-runs', { method: 'POST', body: form })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(new Headers(init?.headers).get('content-type')).toBeNull()
  })

  it('throws ApiError with the typed code for a known error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        {
          error: {
            code: 'unauthenticated',
            message: 'Sign in is required.',
            requestId: 'req_123',
          },
        },
        401,
      ),
    )

    await expect(apiFetch('/api/me')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
      requestId: 'req_123',
    })

    try {
      await apiFetch('/api/me')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
    }
  })

  it('falls back to storage_unavailable for an unparseable error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({ unexpected: true }, 502),
    )

    await expect(apiFetch('/api/matters')).rejects.toMatchObject({
      code: 'storage_unavailable',
      status: 502,
    })
  })

  it('passes a valid-but-unfamiliar error code straight through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        {
          error: {
            code: 'matter_not_found',
            message: 'Matter not found.',
            requestId: 'req_456',
          },
        },
        404,
      ),
    )

    await expect(apiFetch('/api/matters/missing')).rejects.toMatchObject({
      code: 'matter_not_found',
      status: 404,
      requestId: 'req_456',
    })
  })

  it('apiFetchBlobResult returns the blob with its response headers', async () => {
    const headers = new Headers({ 'x-obiter-comments-skipped': '1' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      blob: async () => new Blob(),
    } as Response)

    const result = await apiFetchBlobResult('/api/documents/doc_1/export')

    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.headers.get('x-obiter-comments-skipped')).toBe('1')
  })
})
