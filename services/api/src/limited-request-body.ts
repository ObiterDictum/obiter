import type { Context } from 'hono'
import type { ApiErrorCode, ApiErrorResponse } from '@obiter/contracts'
import { DEFAULT_JSON_BODY_MAX_BYTES } from './request-limit-defaults'

export class RequestBodyTooLargeError extends Error {
  readonly limitKind: 'json' | 'upload'

  constructor(limitKind: 'json' | 'upload') {
    super(
      limitKind === 'json'
        ? 'Request body exceeds the 48 KiB JSON limit.'
        : 'Request body exceeds the 25 MB upload limit.',
    )
    this.name = 'RequestBodyTooLargeError'
    this.limitKind = limitKind
  }
}

export function payloadTooLargeMessage(limitKind: 'json' | 'upload') {
  return new RequestBodyTooLargeError(limitKind).message
}

function parseContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Reject when Content-Length is present, finite, and above maxBytes. */
export function contentLengthExceedsLimit(
  request: Request,
  maxBytes: number,
): boolean {
  const contentLength = parseContentLength(request)
  return contentLength !== null && contentLength > maxBytes
}

/** Stream-read the body and abort once maxBytes is exceeded. */
export async function readBoundedBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = request.body
  if (!body) return new Uint8Array()

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new RequestBodyTooLargeError(
          maxBytes <= DEFAULT_JSON_BODY_MAX_BYTES ? 'json' : 'upload',
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error
    await reader.cancel().catch(() => {})
    throw error
  }

  if (chunks.length === 0) return new Uint8Array()
  if (chunks.length === 1) return chunks[0]!

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export function payloadTooLargeResponse(
  c: Context,
  limitKind: 'json' | 'upload',
): Response {
  const body: ApiErrorResponse = {
    error: {
      code: 'payload_too_large' satisfies ApiErrorCode,
      message: payloadTooLargeMessage(limitKind),
      requestId: c.get('requestId' as never) as string,
    },
  }
  return c.json(body, 413)
}

export async function readLimitedJsonValue(
  c: Context,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (contentLengthExceedsLimit(c.req.raw, maxBytes)) {
    return { ok: false, response: payloadTooLargeResponse(c, 'json') }
  }

  let bytes: Uint8Array
  try {
    bytes = await readBoundedBodyBytes(c.req.raw, maxBytes)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, response: payloadTooLargeResponse(c, 'json') }
    }
    throw error
  }

  if (bytes.byteLength === 0) return { ok: true, value: null }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    }
  } catch {
    return { ok: true, value: null }
  }
}

export async function readLimitedFormData(
  c: Context,
  maxBytes: number,
): Promise<{ ok: true; form: FormData } | { ok: false; response: Response }> {
  if (contentLengthExceedsLimit(c.req.raw, maxBytes)) {
    return { ok: false, response: payloadTooLargeResponse(c, 'upload') }
  }

  let bytes: Uint8Array
  try {
    bytes = await readBoundedBodyBytes(c.req.raw, maxBytes)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, response: payloadTooLargeResponse(c, 'upload') }
    }
    throw error
  }

  const headers = new Headers(c.req.raw.headers)
  const request = new Request(c.req.url, {
    method: c.req.method,
    headers,
    body: bytes,
  })
  const form = await request.formData()
  return { ok: true, form }
}

export async function readLimitedJsonBody(
  c: Context,
  maxBytes: number,
): Promise<Record<string, unknown> | null | Response> {
  const parsed = await readLimitedJsonValue(c, maxBytes)
  if (!parsed.ok) return parsed.response
  const value = parsed.value
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
