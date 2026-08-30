import type { Pool } from 'pg'
import type { ApiErrorCode, ApiErrorResponse } from '@obiter/contracts'
import type { AuthzContext, AuthzVariables } from '../authz'
import { ensureOrgUser } from '../authz'
import { readLimitedJsonBody } from '../limited-request-body'
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../request-limit-defaults'
import { detectRedactionSpans } from '../redaction-detection'
import { publicRun } from '../redaction-database'

export type RouteVariables = AuthzVariables
export type RouteContext = AuthzContext

export function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

export async function requireUser(c: RouteContext, pool: Pool) {
  return ensureOrgUser(c, pool)
}

export async function jsonBody(
  c: RouteContext,
  maxBytes: number = DEFAULT_JSON_BODY_MAX_BYTES,
) {
  const value = await readLimitedJsonBody(c, maxBytes)
  if (value instanceof Response) return value
  return value
}

export const MAX_REDACTION_SOURCE_TEXT_LENGTH = 200_000

export function validSourceText(text: string) {
  return text.length <= MAX_REDACTION_SOURCE_TEXT_LENGTH
}

export async function detectForRoute(c: RouteContext, text: string) {
  try {
    return await detectRedactionSpans(text)
  } catch (error) {
    console.error('redaction_detection_failed', {
      requestId: c.get('requestId'),
      reason: error instanceof Error ? error.message : 'unknown failure',
    })
    return errorResponse(
      c,
      'redaction_detection_failed',
      'Redaction detection could not complete for this document.',
      500,
    )
  }
}

export function listItem(run: ReturnType<typeof publicRun>) {
  const { spans: _spans, decisions: _decisions, ...item } = run
  return item
}
