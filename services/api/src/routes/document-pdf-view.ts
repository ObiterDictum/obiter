import { Hono } from 'hono'
import type { Pool } from 'pg'
import { documentPdfViewResponseSchema } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  DocumentPdfViewStoreError,
  getDocumentPdfView,
} from '../document-pdf-view-store'
import type { StorageService } from '../storage'
import { resolveCurrentReadyDocumentVersion } from './document-route-shared'

export function createDocumentPdfViewRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/pdf-view', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'pdf',
    )
    if (resolved instanceof Response) return resolved

    const view = await getDocumentPdfView(storage, resolved.version)
    const response = documentPdfViewResponseSchema.safeParse({
      documentId: resolved.document.id,
      versionId: resolved.version.id,
      versionNumber: resolved.version.versionNumber,
      text: view.text,
      layout: view.layout,
    })
    if (!response.success) throw new DocumentPdfViewStoreError()
    return c.json(response.data)
  })

  return routes
}
