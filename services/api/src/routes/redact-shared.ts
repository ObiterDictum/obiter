import type { ApiErrorCode, ApiErrorResponse } from '@obiter/contracts'
import type { AuthzContext, AuthzVariables } from '../authz'
import { detectRedactionSpans } from '../redaction-detection'
import { publicRun } from '../redaction-database'

export type RouteVariables = AuthzVariables
export type RouteContext = AuthzContext

export function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

export function requireUser(
  c: RouteContext,
): { id: string; organisationId: string } | Response {
  const user = c.get('user')
  if (!user)
    return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  if (!user.organisationId)
    return errorResponse(
      c,
      'no_organisation',
      'Create an organisation to use this area.',
      403,
    )
  return { id: user.id, organisationId: user.organisationId }
}

export async function jsonBody(c: RouteContext) {
  const value: unknown = await c.req.json().catch(() => null)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
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
