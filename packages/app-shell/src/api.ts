import {
  parseApiErrorResponse,
  type ApiErrorCode,
} from '@obiter/contracts/api-error-response'
import { apiUrl } from './lib/api-url'
import { getDesktopAuthToken } from './lib/auth-token'
import { readDesktopBridge } from './lib/desktop-bridge'
import { getServerRequest } from './lib/server-request'

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

async function readJsonOrNull(response: Response) {
  try {
    // SAFETY: response.json() yields an untyped body; callers validate it via safeParse before use.
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

async function throwApiError(response: Response): Promise<never> {
  const parsed = await readJsonOrNull(response)
  const result = parseApiErrorResponse(parsed)
  if (result) {
    throw new ApiError(
      result.error.code,
      result.error.message,
      response.status,
      result.error.requestId,
    )
  }

  throw new ApiError(
    'storage_unavailable',
    'The API returned an unexpected error response.',
    response.status,
    UNKNOWN_REQUEST_ID,
  )
}

async function serverCookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {}
  // @ts-ignore, double cast) in tests. See
  try {
    const req = getServerRequest()
    if (!req) return {}
    const cookie = req.headers.get('cookie')
    if (cookie) return { Cookie: cookie }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isExpectedNotInRequest =
      message.includes('No StartEvent') ||
      message.includes('not in a request') ||
      message.includes('No request')
    if (isExpectedNotInRequest) return {}
    throw error
  }
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
    // SAFETY: 204/205 carry no body by HTTP semantics, so undefined is the only honest value; callers instantiate T as the empty-response type for such endpoints.
    return undefined as T
  }

  if (!response.ok) await throwApiError(response)

  // SAFETY: non-ok responses throw above; each call site instantiates T with that endpoint's contract response type.
  return (await response.json()) as T
}

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

  if (!response.ok) await throwApiError(response)

  return { blob: await response.blob(), headers: response.headers }
}

export async function apiFetchBlob(
  input: string,
  init?: RequestInit,
): Promise<Blob> {
  const { blob } = await apiFetchBlobResult(input, init)
  return blob
}
