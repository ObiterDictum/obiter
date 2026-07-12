import type { ApiErrorCode } from '@obiter/contracts'
import { apiErrorResponseSchema } from '@obiter/contracts'
import { apiUrl } from './lib/api-url'

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
 * - On a non-2xx response, parses the body through `apiErrorResponseSchema` and
 *   throws an `ApiError` carrying the typed `code`. A response that is not the
 *   expected envelope is treated as a storage-level failure (no silent success).
 * - Network-level failures (fetch itself rejects) propagate as native Errors.
 */
export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(apiUrl(input), {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
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
