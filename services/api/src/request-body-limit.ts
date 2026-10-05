import type { MiddlewareHandler } from 'hono'
import type { ApiRequestLimits } from './request-limits'
import {
  contentLengthExceedsLimit,
  readBoundedBodyBytes,
  RequestBodyTooLargeError,
  payloadTooLargeResponse,
} from './limited-request-body'

const MATTER_DOCUMENTS_UPLOAD_PATH = /^\/api\/matters\/[^/]+\/documents$/

/**
 * The only routes admitted past the general JSON cap. Edit batches carry
 * base64 picture payloads that cannot fit 48 KiB; the image contract bound
 * sits below this transport cap so a maximum-sized picture still parses.
 */
const DOCUMENT_EDIT_PATH =
  /^\/api\/documents\/[^/]+\/(?:edit|collaboration\/merge)$/

interface RequestBodyLimit {
  maxBytes: number
  limitKind: 'json' | 'upload'
}

function requestBodyMaxBytes(
  method: string,
  path: string,
  contentType: string | undefined,
  limits: ApiRequestLimits,
  authenticated: boolean,
): RequestBodyLimit {
  if (
    authenticated &&
    method === 'POST' &&
    contentType?.toLowerCase().startsWith('multipart/form-data') &&
    (MATTER_DOCUMENTS_UPLOAD_PATH.test(path) || path === '/api/redaction-runs')
  ) {
    return {
      maxBytes: limits.documentUploadMaxBytes,
      limitKind: 'upload',
    }
  }

  if (method === 'POST' && DOCUMENT_EDIT_PATH.test(path)) {
    return {
      maxBytes: limits.documentEditMaxBytes,
      limitKind: 'json',
    }
  }

  return {
    maxBytes: limits.jsonBodyMaxBytes,
    limitKind: 'json',
  }
}

export function createRequestBodyLimitMiddleware(
  limits: ApiRequestLimits,
): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.raw
    if (raw.body === null) {
      await next()
      return
    }

    const { maxBytes, limitKind } = requestBodyMaxBytes(
      c.req.method,
      c.req.path,
      c.req.header('content-type'),
      limits,
      Boolean(c.get('user')),
    )

    if (contentLengthExceedsLimit(raw, maxBytes)) {
      return payloadTooLargeResponse(c, limitKind)
    }

    let bytes: Uint8Array
    try {
      bytes = await readBoundedBodyBytes(raw, maxBytes)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return payloadTooLargeResponse(c, limitKind)
      }
      throw error
    }

    const method = c.req.method
    if (method === 'GET' || method === 'HEAD') {
      await next()
      return
    }

    c.req.raw = new Request(raw.url, {
      method,
      headers: raw.headers,
      body: bytes,
      duplex: 'half',
    })
    await next()
  }
}
