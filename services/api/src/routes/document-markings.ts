import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  documentMarkingsRequestSchema,
  documentMarkingsResponseSchema,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  createMarkingsVersion,
  DocumentEditInvalidError,
} from '../document-versions'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
} from './document-route-shared'

type RouteContext = Context<{ Variables: AuthzVariables }>

/**
 * POST /api/documents/:id/markings — commits the document classification and
 * markings (Document type, Draft, Privileged, Without prejudice) as a new
 * immutable version. Like every version mutation it requires matter edit
 * access, names its base version, and answers `stale` when the head moved.
 */
export function createDocumentMarkingsRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.post('/api/documents/:id/markings', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'edit',
    )
    if (resolved instanceof Response) return resolved

    const request = documentMarkingsRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) return validationFailed(c)
    if (request.data.baseVersionId !== resolved.version.id) {
      return conflictDetected(c)
    }

    let result
    try {
      result = await createMarkingsVersion(pool, storage, {
        organisationId: resolved.user.organisationId,
        matterId: resolved.document.matterId,
        documentId: resolved.document.id,
        baseVersionId: request.data.baseVersionId,
        baseVersion: resolved.version,
        markings: request.data.markings,
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
      documentMarkingsResponseSchema.parse({
        documentId: resolved.document.id,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        markings: request.data.markings,
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
      message: 'The markings request is invalid.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 400)
}

function conflictDetected(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'conflict_detected',
      message: 'The document has changed since editing began.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 409)
}
