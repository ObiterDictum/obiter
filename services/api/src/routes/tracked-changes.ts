import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  documentEditResponseSchema,
  documentTrackedChangeDecisionRequestSchema,
  documentTrackedChangeListResponseSchema,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  createTrackedChangeDecisionVersion,
  DocumentEditInvalidError,
  readDocumentTrackedChanges,
} from '../document-versions'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
  resolveReadyDocumentVersion,
} from './document-route-shared'

type RouteContext = Context<{ Variables: AuthzVariables }>

export function createTrackedChangeRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/tracked-changes', async (c) => {
    c.header('Cache-Control', 'no-store')
    const versionId = c.req.query('versionId')
    const resolved = await resolveReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'view',
      versionId === undefined ? {} : { versionId },
    )
    if (resolved instanceof Response) return resolved

    const response = documentTrackedChangeListResponseSchema.safeParse({
      documentId: resolved.document.id,
      versionId: resolved.version.id,
      versionNumber: resolved.version.versionNumber,
      changes: await readDocumentTrackedChanges(storage, {
        organisationId: resolved.user.organisationId,
        matterId: resolved.document.matterId,
        documentId: resolved.document.id,
        baseVersionId: resolved.version.id,
        baseVersion: resolved.version,
      }),
    })
    if (!response.success) throw new Error('Invalid tracked change response.')
    return c.json(response.data)
  })

  routes.post('/api/documents/:id/tracked-changes/decision', async (c) => {
    c.header('Cache-Control', 'no-store')
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'edit',
    )
    if (resolved instanceof Response) return resolved

    const request = documentTrackedChangeDecisionRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) return validationFailed(c)
    if (request.data.baseVersionId !== resolved.version.id) {
      return conflictDetected(c)
    }

    let result
    try {
      result = await createTrackedChangeDecisionVersion(pool, storage, {
        organisationId: resolved.user.organisationId,
        matterId: resolved.document.matterId,
        documentId: resolved.document.id,
        baseVersionId: request.data.baseVersionId,
        baseVersion: resolved.version,
        action: request.data.action,
        changeIds: request.data.changeIds,
        userId: resolved.user.id,
        requestId: c.get('requestId'),
      })
    } catch (error) {
      if (error instanceof DocumentEditInvalidError) {
        return validationFailed(c)
      }
      throw error
    }

    if (result.status === 'not_found') return documentNotFound(c)
    if (result.status === 'stale') return conflictDetected(c)
    return c.json(
      documentEditResponseSchema.parse({
        documentId: resolved.document.id,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
      }),
      201,
    )
  })

  return routes
}

function validationFailed(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'validation_failed',
      message: 'The tracked change request is invalid.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 400)
}

function conflictDetected(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'conflict_detected',
      message: 'The document has changed since review began.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 409)
}
