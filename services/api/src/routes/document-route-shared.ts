import type { Context } from 'hono'
import type { Pool } from 'pg'
import type { ApiErrorResponse, MatterAccessLevel } from '@obiter/contracts'
import {
  ensureOrgUser,
  type AuthenticatedOrgUser,
  type AuthzVariables,
} from '../authz'
import { getDocument } from '../document-database'
import { resolveMatterAccess } from '../document-access'

type RouteContext = Context<{ Variables: AuthzVariables }>

export async function resolveCurrentReadyDocumentVersion(
  c: RouteContext,
  pool: Pool,
  documentId: string,
  fileType: string | null,
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
  fileType: string | null,
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
    (fileType !== null && version.fileType !== fileType)
  ) {
    return documentNotFound(c)
  }

  if (
    version.id !== result.document.currentVersionId &&
    (await canReadDocumentHistory(pool, user, result.document.matterId)) ===
      false
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

export async function canReadDocumentHistory(
  pool: Pool,
  user: AuthenticatedOrgUser,
  matterId: string,
) {
  return (await resolveMatterAccess(pool, user, matterId, 'edit')) === 'edit'
}

export function requestedVersionSelection(c: RouteContext) {
  const versionId = c.req.query('versionId')
  return versionId === undefined ? {} : { versionId }
}

export function conflictDetected(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'conflict_detected',
      message: 'The document has changed since editing began.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 409)
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
