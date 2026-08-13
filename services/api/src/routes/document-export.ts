import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzVariables } from '../authz'
import {
  DOCUMENT_EXPORT_CONTENT_TYPE,
  documentExportContentDisposition,
  exportDocumentDocx,
} from '../document-export'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveReadyDocumentVersion,
} from './document-route-shared'

export function createDocumentExportRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/export', async (c) => {
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

    const exported = await exportDocumentDocx(pool, storage, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
      version: resolved.version,
      userId: resolved.user.id,
      requestId: c.get('requestId'),
    })
    if (exported.status === 'not_found') return documentNotFound(c)

    return new Response(Uint8Array.from(exported.bytes), {
      status: 200,
      headers: {
        'content-type': DOCUMENT_EXPORT_CONTENT_TYPE,
        'content-disposition': documentExportContentDisposition(
          exported.filename,
        ),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  })

  return routes
}
