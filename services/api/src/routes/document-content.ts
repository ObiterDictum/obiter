import { Hono } from 'hono'
import type { Pool } from 'pg'
import { documentTextResponseSchema } from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  createDocumentObjectKey,
  type DocumentVersionRecord,
} from '../database'
import {
  DocumentArtifactStoreError,
  validateAndDeriveDocumentObjectKey,
} from '../document-artifact-store'
import { createDocumentMediaResponse } from '../document-media-response'
import type { StorageService } from '../storage'
import { resolveCurrentReadyDocumentVersion } from './document-route-shared'

export class DocumentDownloadError extends DocumentArtifactStoreError {
  constructor() {
    super('The document could not be downloaded.')
  }
}

export class DocumentTextError extends DocumentArtifactStoreError {
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

function downloadFilename(filename: string) {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  const leaf = slash === -1 ? filename : filename.slice(slash + 1)
  let next = ''
  for (const ch of leaf) {
    const code = ch.charCodeAt(0)
    if (code < 32 || code === 127 || ch === '"' || ch === '/' || ch === '\\') {
      continue
    }
    next += ch
  }
  const cleaned = next.trim()
  const base = cleaned.length > 0 ? cleaned : 'document'
  return base.length <= 200 ? base : base.slice(0, 200)
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

  // Raw source bytes for any ready version, whatever its type. DOCX keeps
  // its comment-embedding /export; this route is the byte-identical way back
  // to what was uploaded (PDF, TXT, and anything else with no viewer).
  routes.get('/api/documents/:id/download', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      null,
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
      // A view, not a copy: Response reads the bytes at construction and
      // `source` is never mutated afterwards, so sharing the Buffer's
      // memory is safe (byteOffset/length keep pooled Buffers windowed).
      new Uint8Array(source.buffer, source.byteOffset, source.length),
      downloadContentType(version.fileType),
      downloadFilename(version.filename),
    )
  })

  // Plain-text view for ready TXT versions. DOCX answers /model and PDF
  // answers /pdf-view; TXT had no view route until this one.
  //
  // Deliberately uncapped: the 200,000-character bound in
  // document-extraction applies to the PDF path only, where it bounds
  // per-glyph geometry work and layout size. TXT extraction is plain UTF-8
  // decoding, and the siblings are likewise whole-content (/model serves
  // the full DOCX model, /export the full DOCX bytes), so truncating here
  // would corrupt the round-trip without bounding any real work. The hard
  // bound is the upload cap (MAX_DOCUMENT_UPLOAD_BYTES, 25 MB); a stored
  // text that fails the response schema still fails closed below.
  routes.get('/api/documents/:id/text', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'txt',
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
