import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorResponse } from '@obiter/contracts'
import { ensureOrgUser, type AuthzVariables } from '../authz'
import { getDocument } from '../database'
import { requireMatterAccess } from '../document-access'

type RouteContext = Context<{ Variables: AuthzVariables }>

export async function resolveCurrentReadyDocumentVersion(
  c: RouteContext,
  pool: Pool,
  documentId: string,
  fileType: string,
) {
  c.header('Cache-Control', 'no-store')

  const user = await ensureOrgUser(c, pool)
  if (user instanceof Response) return user

  const result = await getDocument(pool, user.organisationId, documentId)
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
    version.fileType !== fileType
  ) {
    return documentNotFound(c)
  }

  return { document: result.document, version }
}

export function documentNotFound(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'document_not_found',
      message: 'Document not found.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 404)
}
