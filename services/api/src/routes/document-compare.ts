import { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  documentCompareQuerySchema,
  documentCompareResponseSchema,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import { compareDocumentModels } from '../document-compare'
import { getDocumentModel } from '../document-model-store'
import type { StorageService } from '../storage'
import { resolveReadyDocumentVersion } from './document-route-shared'

export function createDocumentCompareRoutes(
  pool: Pool,
  storage: StorageService,
) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  /**
   * Compare two ready versions of one document. Both inputs pass the shared
   * version resolver — organisation, matter, document, readiness and the
   * historical-version gate — so a caller cannot reach a denied version's
   * model by naming it on either side of the pair.
   */
  routes.get('/api/documents/:id/compare', async (c) => {
    const query = documentCompareQuerySchema.safeParse({
      baseVersionId: c.req.query('baseVersionId'),
      targetVersionId: c.req.query('targetVersionId'),
    })
    if (!query.success) {
      const body: ApiErrorResponse = {
        error: {
          code: 'validation_failed',
          message: 'The version comparison request is invalid.',
          requestId: c.get('requestId'),
        },
      }
      return c.json(body, 400)
    }

    const documentId = c.req.param('id')
    const base = await resolveReadyDocumentVersion(
      c,
      pool,
      documentId,
      'docx',
      'view',
      {
        versionId: query.data.baseVersionId,
      },
    )
    if (base instanceof Response) return base
    const target = await resolveReadyDocumentVersion(
      c,
      pool,
      documentId,
      'docx',
      'view',
      { versionId: query.data.targetVersionId },
    )
    if (target instanceof Response) return target

    const [baseModel, targetModel] = await Promise.all([
      getDocumentModel(storage, base.version),
      getDocumentModel(storage, target.version),
    ])
    const compared = compareDocumentModels(baseModel, targetModel)

    const byteIdentical =
      base.version.contentSha256 === target.version.contentSha256
    const notes: string[] = []
    if (!byteIdentical) {
      // The model covers paragraphs, formatting, story structure, styles,
      // numbering, relationships, revisions and comments — not opaque package
      // parts like media bytes. When the files differ but no entry explains
      // why, the difference is outside the compared surface; say so rather
      // than reporting a clean document.
      notes.push(
        'The comparison covers the document model; package parts outside it may also differ.',
      )
    }

    const response = documentCompareResponseSchema.safeParse({
      documentId: base.document.id,
      base: {
        versionId: base.version.id,
        versionNumber: base.version.versionNumber,
      },
      target: {
        versionId: target.version.id,
        versionNumber: target.version.versionNumber,
      },
      identical: compared.entries.length === 0 && byteIdentical,
      entries: compared.entries,
      entriesTruncated: compared.truncated,
      notes,
    })
    if (!response.success) {
      throw new Error('Invalid document comparison response.')
    }
    return c.json(response.data)
  })

  return routes
}
