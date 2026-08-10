import { Hono } from 'hono'
import type { Pool } from 'pg'
import { documentModelResponseSchema } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  DocumentModelStoreError,
  getDocumentModel,
} from '../document-model-store'
import type { StorageService } from '../storage'
import { resolveCurrentReadyDocumentVersion } from './document-route-shared'

export function createDocumentModelRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/model', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
    )
    if (resolved instanceof Response) return resolved

    const response = documentModelResponseSchema.safeParse({
      documentId: resolved.document.id,
      versionId: resolved.version.id,
      versionNumber: resolved.version.versionNumber,
      model: await getDocumentModel(storage, resolved.version),
    })
    if (!response.success) throw new DocumentModelStoreError()
    return c.json(response.data)
  })

  return routes
}
