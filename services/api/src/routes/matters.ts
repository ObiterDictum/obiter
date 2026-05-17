import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorCode, ApiErrorResponse } from '@ormont/contracts'
import {
  appendAuditLog,
  createMatter,
  getMatter,
  listMatters,
  restoreMatter,
  softDeleteMatter,
  updateMatter,
  type MatterStatus,
} from '../database'

interface RouteUser {
  id: string
  organisationId?: string | null
}

interface AuthenticatedRouteUser {
  id: string
  organisationId: string
}

interface RouteVariables {
  requestId: string
  user: RouteUser | null
}

type RouteContext = Context<{ Variables: RouteVariables }>

const matterStatuses = new Set<MatterStatus>(['active', 'archived', 'deleted'])

function errorResponse(c: RouteContext, code: ApiErrorCode, message: string, status: 400 | 401 | 403 | 404) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function requireUser(c: RouteContext): AuthenticatedRouteUser | Response {
  const user = c.get('user')
  if (!user) {
    return errorResponse(c, 'unauthenticated', 'Sign in is required.', 401)
  }
  if (!user.organisationId) {
    return errorResponse(c, 'organisation_not_found', 'The signed-in user does not have an active organisation.', 404)
  }
  return { id: user.id, organisationId: user.organisationId }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nullableStringValue(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

function matterStatus(value: unknown): MatterStatus | undefined {
  return typeof value === 'string' && matterStatuses.has(value as MatterStatus)
    ? (value as MatterStatus)
    : undefined
}

export function createMattersRoutes(pool: Pool) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.post('/api/matters', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const body = asRecord(await c.req.json().catch(() => null))
    const name = stringValue(body?.name)
    const description = nullableStringValue(body?.description)
    const primaryJurisdiction = stringValue(body?.primaryJurisdiction)
    const secondaryJurisdictions = stringArray(body?.secondaryJurisdictions)
    const legalDomains = stringArray(body?.legalDomains)
    const clientReference = stringValue(body?.clientReference)

    if (!body || !name || !primaryJurisdiction) {
      return errorResponse(c, 'validation_failed', 'name and primaryJurisdiction are required.', 400)
    }
    if (body.description !== undefined && description === undefined) {
      return errorResponse(c, 'validation_failed', 'Invalid matter description.', 400)
    }
    if (body.secondaryJurisdictions !== undefined && !secondaryJurisdictions) {
      return errorResponse(c, 'validation_failed', 'Invalid secondaryJurisdictions.', 400)
    }
    if (body.legalDomains !== undefined && !legalDomains) {
      return errorResponse(c, 'validation_failed', 'Invalid legalDomains.', 400)
    }

    const matter = await createMatter(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      name,
      description,
      primaryJurisdiction,
      secondaryJurisdictions,
      legalDomains,
      clientReference,
    })
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.create',
      metadata: {},
      requestId: c.get('requestId'),
    })

    return c.json({ matter }, 201)
  })

  routes.get('/api/matters', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matters = await listMatters(pool, user.organisationId, {
      includeDeleted: c.req.query('includeDeleted') === 'true',
    })
    return c.json({ matters })
  })

  routes.get('/api/matters/:id', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matter = await getMatter(pool, user.organisationId, c.req.param('id'), {
      includeDeleted: c.req.query('includeDeleted') === 'true',
    })
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    return c.json({ matter })
  })

  routes.patch('/api/matters/:id', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const body = asRecord(await c.req.json().catch(() => null))
    const name = stringValue(body?.name)
    const description = nullableStringValue(body?.description)
    const primaryJurisdiction = stringValue(body?.primaryJurisdiction)
    const secondaryJurisdictions = stringArray(body?.secondaryJurisdictions)
    const legalDomains = stringArray(body?.legalDomains)
    const clientReference = stringValue(body?.clientReference)
    const status = matterStatus(body?.status)

    if (!body) {
      return errorResponse(c, 'validation_failed', 'Invalid matter update payload.', 400)
    }
    if (body.name !== undefined && !name) {
      return errorResponse(c, 'validation_failed', 'Invalid matter name.', 400)
    }
    if (body.description !== undefined && description === undefined) {
      return errorResponse(c, 'validation_failed', 'Invalid matter description.', 400)
    }
    if (body.primaryJurisdiction !== undefined && !primaryJurisdiction) {
      return errorResponse(c, 'validation_failed', 'Invalid primaryJurisdiction.', 400)
    }
    if (body.secondaryJurisdictions !== undefined && !secondaryJurisdictions) {
      return errorResponse(c, 'validation_failed', 'Invalid secondaryJurisdictions.', 400)
    }
    if (body.legalDomains !== undefined && !legalDomains) {
      return errorResponse(c, 'validation_failed', 'Invalid legalDomains.', 400)
    }
    if (body.status !== undefined && !status) {
      return errorResponse(c, 'validation_failed', 'Invalid matter status.', 400)
    }

    const matter = await updateMatter(pool, user.organisationId, c.req.param('id'), {
      ...(name === undefined ? {} : { name }),
      ...(body.description === undefined ? {} : { description }),
      ...(primaryJurisdiction === undefined ? {} : { primaryJurisdiction }),
      ...(secondaryJurisdictions === undefined ? {} : { secondaryJurisdictions }),
      ...(legalDomains === undefined ? {} : { legalDomains }),
      ...(clientReference === undefined ? {} : { clientReference }),
      ...(status === undefined ? {} : { status }),
    })
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.update',
      metadata: {},
      requestId: c.get('requestId'),
    })
    return c.json({ matter })
  })

  routes.delete('/api/matters/:id', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matter = await softDeleteMatter(pool, user.organisationId, c.req.param('id'))
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.delete',
      metadata: {},
      requestId: c.get('requestId'),
    })
    return c.json({ matter })
  })

  routes.patch('/api/matters/:id/restore', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matter = await restoreMatter(pool, user.organisationId, c.req.param('id'))
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }
    return c.json({ matter })
  })

  return routes
}
