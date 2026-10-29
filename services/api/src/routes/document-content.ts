import { Hono } from 'hono'
import type { Pool } from 'pg'
import { documentTextResponseSchema } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../document-database'
import { type DocumentVersionRecord } from '../database-records'
import {
  DocumentDerivedStoreError,
  validateAndDeriveDocumentObjectKey,
} from '../document-derived-store'
import { createDocumentMediaResponse } from '../document-media-response'
import type { StorageService } from '../storage'
import {
  requestedVersionSelection,
  resolveReadyDocumentVersion,
} from './document-route-shared'

class DocumentDownloadError extends DocumentDerivedStoreError {
  constructor() {
    super('The document could not be downloaded.')
  }
}

class DocumentTextError extends DocumentDerivedStoreError {
  constructor() {
    super('The document text could not be read.')
  }
}

type DownloadVersion = Pick<
  DocumentVersionRecord,
  | 'id'
  | 'organisationId'
  | 'matterId'
  | 'matterDocumentId'
  | 'objectKey'
  | 'filename'
  | 'fileType'
>

type TextVersion = Pick<
  DocumentVersionRecord,
  | 'id'
  | 'organisationId'
  | 'matterId'
  | 'matterDocumentId'
  | 'objectKey'
  | 'textObjectKey'
  | 'versionNumber'
>

function downloadContentType(fileType: string) {
  if (fileType === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (fileType === 'pdf') return 'application/pdf'
  if (fileType === 'txt') return 'text/plain;charset=utf-8'
  return 'application/octet-stream'
}

function expectedSourceKey(
  version: Pick<
    DownloadVersion,
    'organisationId' | 'matterId' | 'matterDocumentId' | 'id'
  >,
) {
  return createDocumentObjectKey({
    organisationId: version.organisationId,
    matterId: version.matterId,
    documentId: version.matterDocumentId,
    versionId: version.id,
  })
}

export function createDocumentContentRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/download', async (c) => {
    const resolved = await resolveReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      null,
      'view',
      requestedVersionSelection(c),
    )
    if (resolved instanceof Response) return resolved

    const version: DownloadVersion = resolved.version
    if (version.objectKey !== expectedSourceKey(version)) {
      throw new DocumentDownloadError()
    }
    if (!storage.readBinary) throw new DocumentDownloadError()

    let source: Buffer
    try {
      source = await storage.readBinary(version.objectKey)
    } catch {
      throw new DocumentDownloadError()
    }

    return createDocumentMediaResponse(
      new Uint8Array(source.buffer, source.byteOffset, source.length),
      downloadContentType(version.fileType),
      version.filename,
    )
  })

  routes.get('/api/documents/:id/text', async (c) => {
    const resolved = await resolveReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'txt',
      'view',
      requestedVersionSelection(c),
    )
    if (resolved instanceof Response) return resolved

    const version: TextVersion = resolved.version
    const textObjectKey = validateAndDeriveDocumentObjectKey(
      version,
      'text',
      () => new DocumentTextError(),
    )
    if (version.textObjectKey !== textObjectKey) {
      throw new DocumentTextError()
    }

    let text: string
    try {
      text = await storage.readText(textObjectKey)
    } catch {
      throw new DocumentTextError()
    }

    const response = documentTextResponseSchema.safeParse({
      documentId: resolved.document.id,
      versionId: version.id,
      versionNumber: resolved.version.versionNumber,
      text,
    })
    if (!response.success) throw new DocumentTextError()
    return c.json(response.data)
  })

  return routes
}
