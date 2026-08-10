import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorResponse } from '@obiter/contracts'
import { documentModelResponseSchema } from '@obiter/contracts'
import { ensureOrgUser, type AuthzVariables } from '../authz'
import { getDocument } from '../database'
import { requireMatterAccess } from '../document-access'
import {
  DocumentModelStoreError,
  getDocumentModel,
} from '../document-model-store'
import type { StorageService } from '../storage'

type RouteContext = Context<{ Variables: AuthzVariables }>

export function createDocumentModelRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/model', async (c) => {
    c.header('Cache-Control', 'no-store')

    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const result = await getDocument(
      pool,
      user.organisationId,
      c.req.param('id'),
    )
    if (!result) return documentNotFound(c)

    const access = await requireMatterAccess(
      c,
      pool,
      result.document.matterId,
      'view',
    )
    if (access instanceof Response) {
      return access.status === 404 ? documentNotFound(c) : access
    }

    const version = result.document.currentVersion
    if (
      !version ||
      version.id !== result.document.currentVersionId ||
      version.organisationId !== user.organisationId ||
      version.matterId !== result.document.matterId ||
      version.matterDocumentId !== result.document.id ||
      version.documentStatus !== 'ready' ||
      version.fileType !== 'docx'
    ) {
      return documentNotFound(c)
    }

    const response = documentModelResponseSchema.safeParse({
      documentId: result.document.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      model: await getDocumentModel(storage, version),
    })
    if (!response.success) throw new DocumentModelStoreError()
    return c.json(response.data)
  })

  return routes
}

function documentNotFound(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'document_not_found',
      message: 'Document not found.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 404)
}
