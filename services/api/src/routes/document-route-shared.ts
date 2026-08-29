import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorResponse, MatterAccessLevel } from '@obiter/contracts'
import { ensureOrgUser, type AuthzVariables } from '../authz'
import { getDocument } from '../database'

type RouteContext = Context<{ Variables: AuthzVariables }>

export async function resolveCurrentReadyDocumentVersion(
  c: RouteContext,
  pool: Pool,
  documentId: string,
  fileType: string,
  requiredAccess: MatterAccessLevel = 'view',
) {
  return resolveReadyDocumentVersion(
    c,
    pool,
    documentId,
    fileType,
    requiredAccess,
    { requireCurrent: true },
  )
}

export async function resolveReadyDocumentVersion(
  c: RouteContext,
  pool: Pool,
  documentId: string,
  fileType: string,
  requiredAccess: MatterAccessLevel,
  selection: { versionId?: string; requireCurrent?: boolean } = {},
) {
  c.header('Cache-Control', 'no-store')

  const user = await ensureOrgUser(c, pool)
  if (user instanceof Response) return user

  const result = await getDocument(pool, user, documentId, requiredAccess)
  if (!result) return documentNotFound(c)

  const selectedId = selection.versionId ?? result.document.currentVersionId
  const version = result.versions.find(({ id }) => id === selectedId)
  if (
    !version ||
    (selection.requireCurrent &&
      version.id !== result.document.currentVersionId) ||
    version.organisationId !== user.organisationId ||
    version.matterId !== result.document.matterId ||
    version.matterDocumentId !== result.document.id ||
    version.documentStatus !== 'ready' ||
    version.fileType !== fileType
  ) {
    return documentNotFound(c)
  }

  return {
    document: result.document,
    version,
    versions: result.versions,
    user,
  }
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
