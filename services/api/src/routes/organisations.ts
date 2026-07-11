import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  ORGANISATION_NAME_MAX_LENGTH,
  type ApiErrorCode,
  type ApiErrorResponse,
} from '@obiter/contracts'
import { createOrganisationForUser } from '../database'

interface RouteUser {
  id: string
  organisationId?: string | null
}

interface RouteVariables {
  requestId: string
  user: RouteUser | null
}

type RouteContext = Context<{ Variables: RouteVariables }>

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 409,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function requireAuthenticatedUser(c: RouteContext): { id: string } | Response {
  const user = c.get('user')
  if (!user) {
    return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  }
  return { id: user.id }
}

/**
 * Organisation creation. Self-registration no longer provisions an org, so an
 * org-less user creates one explicitly here. The single-org model holds: a
 * user that already has an organisation gets a 409 conflict. Creation and the
 * owner assignment are transactional in createOrganisationForUser.
 */
export function createOrganisationsRoutes(pool: Pool) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.post('/api/organisations', async (c) => {
    const user = requireAuthenticatedUser(c)
    if (user instanceof Response) return user

    const value: unknown = await c.req.json().catch(() => null)
    const rawName = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).name
      : undefined

    if (typeof rawName !== 'string') {
      return errorResponse(c, 'validation_failed', 'Organisation name is required.', 400)
    }

    const name = rawName.trim()
    if (name.length === 0) {
      return errorResponse(c, 'validation_failed', 'Organisation name is required.', 400)
    }
    if (name.length > ORGANISATION_NAME_MAX_LENGTH) {
      return errorResponse(
        c,
        'validation_failed',
        `Organisation name must be at most ${ORGANISATION_NAME_MAX_LENGTH} characters.`,
        400,
      )
    }

    const result = await createOrganisationForUser(pool, {
      userId: user.id,
      name,
      requestId: c.get('requestId'),
    })

    if (!result.created) {
      return errorResponse(c, 'conflict_detected', 'You already have an organisation.', 409)
    }

    return c.json({ organisation: result.organisation }, 201)
  })

  return routes
}
