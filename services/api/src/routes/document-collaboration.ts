import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  documentCollaborationConflictResponseSchema,
  documentCollaborationMergeRequestSchema,
  documentCollaborationMergeResponseSchema,
  documentCollaborationSyncResponseSchema,
  documentPresenceUpdateRequestSchema,
  editIdSchema,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { createCollaborationMergeVersion } from '../document-collaboration-versions'
import {
  DocumentPresenceRegistry,
  validateDocumentCursor,
} from '../document-presence'
import {
  createDocumentObjectKey,
  type DocumentVersionRecord,
} from '../database'
import { DocumentEditInvalidError } from '../document-versions'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
} from './document-route-shared'

type RouteContext = Context<{ Variables: AuthzVariables }>

export function createDocumentCollaborationRoutes(
  pool: Pool,
  storage: StorageService,
  presence = new DocumentPresenceRegistry(),
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/collaboration/sync', async (c) => {
    const resolved = await resolveCollaborationDocument(
      c,
      pool,
      c.req.param('id'),
    )
    if (resolved instanceof Response) return resolved

    const sinceVersionId = c.req.query('sinceVersionId')
    if (
      sinceVersionId !== undefined &&
      !editIdSchema.safeParse(sinceVersionId).success
    ) {
      return validationFailed(c, 'The collaboration sync request is invalid.')
    }

    const response = documentCollaborationSyncResponseSchema.parse({
      documentId: resolved.document.id,
      currentVersionId: resolved.version.id,
      currentVersionNumber: resolved.version.versionNumber,
      changed:
        sinceVersionId === undefined || sinceVersionId !== resolved.version.id,
      participants: presence.read(
        resolved.user.organisationId,
        resolved.document.id,
      ),
    })
    return c.json(response)
  })

  routes.put('/api/documents/:id/collaboration/presence', async (c) => {
    const resolved = await resolveCollaborationDocument(
      c,
      pool,
      c.req.param('id'),
    )
    if (resolved instanceof Response) return resolved

    const request = documentPresenceUpdateRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) {
      return validationFailed(c, 'The presence update request is invalid.')
    }
    if (
      request.data.cursor !== null &&
      !(await validateDocumentCursor(
        storage,
        resolved.version,
        request.data.cursor,
      ))
    ) {
      return validationFailed(c, 'The presence update request is invalid.')
    }

    presence.update(
      resolved.user.organisationId,
      resolved.document.id,
      resolved.user.id,
      request.data.cursor,
    )
    return c.body(null, 204)
  })

  routes.post('/api/documents/:id/collaboration/merge', async (c) => {
    const resolved = await resolveCollaborationDocument(
      c,
      pool,
      c.req.param('id'),
    )
    if (resolved instanceof Response) return resolved

    const request = documentCollaborationMergeRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) {
      return validationFailed(c, 'The collaboration merge request is invalid.')
    }
    const baseVersion = resolved.versions.find(
      ({ id }) => id === request.data.baseVersionId,
    )
    if (!baseVersion || !validBaseVersion(baseVersion, resolved.document.id)) {
      return documentNotFound(c)
    }

    let result
    try {
      result = await createCollaborationMergeVersion(pool, storage, {
        organisationId: resolved.user.organisationId,
        matterId: resolved.document.matterId,
        documentId: resolved.document.id,
        baseVersionId: request.data.baseVersionId,
        syncId: request.data.syncId,
        operations: request.data.operations,
        trackChanges: request.data.trackChanges ?? false,
        userId: resolved.user.id,
        userName: resolved.user.name,
        requestId: c.get('requestId'),
      })
    } catch (error) {
      if (error instanceof DocumentEditInvalidError) {
        return validationFailed(
          c,
          'The collaboration merge request is invalid.',
        )
      }
      throw error
    }

    if (result.status === 'not_found') return documentNotFound(c)
    if (result.status === 'conflict') {
      if (
        result.operationIndexes.some(
          (index) => index >= request.data.operations.length,
        )
      ) {
        throw new Error('Invalid collaboration conflict response.')
      }
      const response = documentCollaborationConflictResponseSchema.parse({
        error: {
          code: 'conflict_detected',
          message: 'The document contains overlapping collaboration edits.',
          requestId: c.get('requestId'),
        },
        conflict: {
          documentId: resolved.document.id,
          syncId: request.data.syncId,
          baseVersionId: request.data.baseVersionId,
          currentVersionId: result.currentVersionId,
          currentVersionNumber: result.currentVersionNumber,
          operationIndexes: result.operationIndexes,
        },
      })
      return c.json(response, 409)
    }

    const response = documentCollaborationMergeResponseSchema.parse({
      documentId: resolved.document.id,
      syncId: request.data.syncId,
      baseVersionId: result.baseVersionId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      outcome: result.status,
    })
    return c.json(response, result.status === 'merged' ? 201 : 200)
  })

  return routes
}

function resolveCollaborationDocument(
  c: RouteContext,
  pool: Pool,
  documentId: string,
) {
  return resolveCurrentReadyDocumentVersion(c, pool, documentId, 'docx', 'edit')
}

function validBaseVersion(version: DocumentVersionRecord, documentId: string) {
  return (
    version.matterDocumentId === documentId &&
    version.fileType === 'docx' &&
    version.documentStatus === 'ready' &&
    version.objectKey ===
      createDocumentObjectKey({
        organisationId: version.organisationId,
        matterId: version.matterId,
        documentId,
        versionId: version.id,
      })
  )
}

function validationFailed(c: RouteContext, message: string) {
  const body: ApiErrorResponse = {
    error: {
      code: 'validation_failed',
      message,
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 400)
}
