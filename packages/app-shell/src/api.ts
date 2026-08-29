import type { ApiErrorCode } from '@obiter/contracts'
import { apiErrorResponseSchema } from '@obiter/contracts'
import { apiUrl } from './lib/api-url'
import { getDesktopAuthToken } from './lib/auth-token'
import { readDesktopBridge } from './lib/desktop-bridge'

/**
 * Typed error thrown by `apiFetch` when the API returns a non-2xx response that
 * matches the shared error envelope. The `code` is the parsed `ApiErrorCode`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly requestId: string

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    requestId: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

const UNKNOWN_REQUEST_ID = 'req_unknown'

/**
 * Fetch a JSON endpoint with auth credentials and normalised errors.
 *
 * - Sends `credentials: 'include'` so the better-auth session cookie travels.
 * - On HTTP 204/205, returns `undefined` (presence heartbeats have no body).
 * - On a non-2xx response, parses the body through `apiErrorResponseSchema` and
 *   throws an `ApiError` carrying the typed `code`. A response that is not the
 *   expected envelope is treated as a storage-level failure (no silent success).
 * - Network-level failures (fetch itself rejects) propagate as native Errors.
 */
async function serverCookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {}
  try {
    // Construct specifier dynamically so Vite's static import analysis
    // doesn't try to resolve it at build time (vitest doesn't have the
    // module). Only present when running inside web SSR.
    const prefix = '@tanstack'
    const suffix = '/react-start/server'
    // @ts-ignore — optional SSR dependency
    const mod = (await import((prefix + suffix) as unknown as string)) as {
      getRequest?: () => Request
    }
    const req = mod.getRequest?.()
    const cookie = req?.headers.get('cookie')
    if (cookie) return { Cookie: cookie }
  } catch {}
  return {}
}

export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const desktopToken = readDesktopBridge() ? await getDesktopAuthToken() : null
  const serverCookie = await serverCookieHeader()
  const response = await fetch(apiUrl(input), {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...serverCookie,
      ...(desktopToken ? { Authorization: `Bearer ${desktopToken}` } : {}),
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  })

  if (response.ok && (response.status === 204 || response.status === 205)) {
    return undefined as T
  }

  if (!response.ok) {
    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }

    const result = apiErrorResponseSchema.safeParse(parsed)
    if (result.success) {
      throw new ApiError(
        result.data.error.code,
        result.data.error.message,
        response.status,
        result.data.error.requestId,
      )
    }

    // Non-2xx with an unparseable body: surface a storage-level failure rather
    // than pretending the request succeeded.
    throw new ApiError(
      'storage_unavailable',
      'The API returned an unexpected error response.',
      response.status,
      UNKNOWN_REQUEST_ID,
    )
  }

  return (await response.json()) as T
}

/**
 * Fetch a binary endpoint with the same auth as `apiFetch`, returning the
 * blob together with its response headers so callers can read out-of-band
 * metadata such as `x-obiter-comments-skipped`.
 */
export async function apiFetchBlobResult(
  input: string,
  init?: RequestInit,
): Promise<{ blob: Blob; headers: Headers }> {
  const desktopToken = readDesktopBridge() ? await getDesktopAuthToken() : null
  const serverCookie = await serverCookieHeader()
  const response = await fetch(apiUrl(input), {
    credentials: 'include',
    ...init,
    headers: {
      ...serverCookie,
      ...(desktopToken ? { Authorization: `Bearer ${desktopToken}` } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }

    const result = apiErrorResponseSchema.safeParse(parsed)
    if (result.success) {
      throw new ApiError(
        result.data.error.code,
        result.data.error.message,
        response.status,
        result.data.error.requestId,
      )
    }

    throw new ApiError(
      'storage_unavailable',
      'The API returned an unexpected error response.',
      response.status,
      UNKNOWN_REQUEST_ID,
    )
  }

  return { blob: await response.blob(), headers: response.headers }
}

/**
 * Fetch a binary endpoint with the same auth as `apiFetch`.
 */
export async function apiFetchBlob(
  input: string,
  init?: RequestInit,
): Promise<Blob> {
  const { blob } = await apiFetchBlobResult(input, init)
  return blob
}
