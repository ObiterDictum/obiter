import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzVariables } from '../authz'
import {
  DOCUMENT_EXPORT_CONTENT_TYPE,
  documentExportContentDisposition,
  exportDocumentDocx,
  ShareSafeExportRefusalError,
} from '../document-export'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveReadyDocumentVersion,
} from './document-route-shared'
import { errorResponse } from './redact-shared'

export function createDocumentExportRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/export', async (c) => {
    const mode = c.req.query('mode')
    if (mode !== undefined && mode !== 'standard' && mode !== 'share-safe') {
      return errorResponse(c, 'validation_failed', 'Unknown export mode.', 400)
    }
    const shareSafe = mode === 'share-safe'
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

    try {
      const exported = await exportDocumentDocx(pool, storage, {
        organisationId: resolved.user.organisationId,
        matterId: resolved.document.matterId,
        documentId: resolved.document.id,
        version: resolved.version,
        userId: resolved.user.id,
        requestId: c.get('requestId'),
        shareSafe,
      })
      if (exported.status === 'not_found') return documentNotFound(c)

      const headers = new Headers({
        'content-type': DOCUMENT_EXPORT_CONTENT_TYPE,
        'content-disposition': documentExportContentDisposition(
          exported.filename,
        ),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      if (exported.skippedCommentCount > 0) {
        headers.set(
          'x-obiter-comments-skipped',
          String(exported.skippedCommentCount),
        )
      }
      return new Response(Uint8Array.from(exported.bytes), {
        status: 200,
        headers,
      })
    } catch (error) {
      if (error instanceof ShareSafeExportRefusalError) {
        return errorResponse(
          c,
          'share_safe_export_refused',
          'This document cannot be shared safely: it still carries tracked changes, hidden text, embedded objects, or other content a share-safe export cannot prove clean.',
          422,
        )
      }
      throw error
    }
  })

  return routes
}
