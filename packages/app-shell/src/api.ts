import { reportError } from './error-reporting'
import {
  parseApiErrorResponse,
  type ApiErrorCode,
} from '@obiter/contracts/api-error-response'
import type { OwnedMatter } from '@obiter/contracts'
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
    readonly uncoveredMatters?: OwnedMatter[],
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
      response.status === 409 ? result.error.uncoveredMatters : undefined,
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

async function authorisedFetch(
  input: string,
  init: RequestInit | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const desktopToken = readDesktopBridge() ? await getDesktopAuthToken() : null
  const serverCookie = await serverCookieHeader()
  const response = await fetch(apiUrl(input), {
    credentials: 'include',
    ...init,
    headers: {
      ...headers,
      ...serverCookie,
      ...(desktopToken ? { Authorization: `Bearer ${desktopToken}` } : {}),
      ...init?.headers,
    },
  }).catch((error: unknown) => {
    reportError(new Error('API network request failed'),{route:input,method:init?.method ?? 'GET'})
    throw error
  })
  if (response.status >= 500) reportError(new Error('API server request failed'),{route:input,status:response.status,method:init?.method ?? 'GET'})
  if (!response.ok) await throwApiError(response)
  return response
}

export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await authorisedFetch(input, init, {
    Accept: 'application/json',
    ...(init?.body && !(init.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
  })

  if (response.status === 204 || response.status === 205) {
    // SAFETY: 204/205 carry no body by HTTP semantics, so undefined is the only honest value; callers instantiate T as the empty-response type for such endpoints.
    return undefined as T
  }

  // SAFETY: non-ok responses throw above; each call site instantiates T with that endpoint's contract response type.
  return (await response.json()) as T
}

export function apiFetchEventStream(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  return authorisedFetch(input, init, { Accept: 'text/event-stream' })
}

export async function apiFetchBlobResult(
  input: string,
  init?: RequestInit,
): Promise<{ blob: Blob; headers: Headers }> {
  const response = await authorisedFetch(input, init, {})
  return { blob: await response.blob(), headers: response.headers }
}

export async function apiFetchBlob(
  input: string,
  init?: RequestInit,
): Promise<Blob> {
  const { blob } = await apiFetchBlobResult(input, init)
  return blob
}
