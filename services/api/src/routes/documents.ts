import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorCode, ApiErrorResponse } from '@obiter/contracts'
import {
  appendAuditLog,
  createDocument,
  getDocument,
  getMatter,
  listDocuments,
  softDeleteDocument,
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

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requiredInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function createDocumentsRoutes(pool: Pool) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.post('/api/matters/:matterId/documents', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matter = await getMatter(pool, user.organisationId, c.req.param('matterId'))
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }

    const body = asRecord(await c.req.json().catch(() => null))
    const filename = requiredString(body?.filename)
    const fileType = requiredString(body?.fileType)
    const contentSha256 = requiredString(body?.contentSha256)
    const sizeBytes = requiredInteger(body?.sizeBytes)

    if (!body || !filename || !fileType || !contentSha256 || sizeBytes === null) {
      return errorResponse(c, 'validation_failed', 'Document upload metadata is required.', 400)
    }

    const result = await createDocument(pool, {
      organisationId: user.organisationId,
      matterId: matter.id,
      userId: user.id,
      filename,
      fileType,
      sizeBytes,
      contentSha256,
    })
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'document',
      entityId: result.document.id,
      action: 'document.upload',
      metadata: { versionId: result.version.id },
      requestId: c.get('requestId'),
    })
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'document_version',
      entityId: result.version.id,
      action: 'document.version_create',
      metadata: { documentId: result.document.id },
      requestId: c.get('requestId'),
    })

    return c.json(result, 201)
  })

  routes.get('/api/matters/:matterId/documents', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const matter = await getMatter(pool, user.organisationId, c.req.param('matterId'))
    if (!matter) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }

    const documents = await listDocuments(pool, user.organisationId, matter.id, {
      includeDeleted: c.req.query('includeDeleted') === 'true',
    })
    return c.json({ documents })
  })

  routes.get('/api/documents/:id', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const result = await getDocument(pool, user.organisationId, c.req.param('id'), {
      includeDeleted: c.req.query('includeDeleted') === 'true',
    })
    if (!result) {
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    }
    return c.json(result)
  })

  routes.delete('/api/documents/:id', async (c) => {
    const user = requireUser(c)
    if (user instanceof Response) return user

    const document = await softDeleteDocument(pool, user.organisationId, c.req.param('id'))
    if (!document) {
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    }
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'document',
      entityId: document.id,
      action: 'document.delete',
      metadata: {},
      requestId: c.get('requestId'),
    })
    return c.json({ document })
  })

  return routes
}
