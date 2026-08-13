import { parseDocx } from '@obiter/ooxml'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EXPORT_CONTENT_TYPE,
  documentExportFilename,
} from '../document-export'
import {
  expectDocument404,
  fixtureParagraphId,
  MemoryStorage,
  queryKind,
  routeApp,
  sourceBytes,
  sourceObjectKey,
  TestDatabase,
} from './document-export.test-support'

describe('documentExportFilename', () => {
  it('keeps a normal Word filename', () => {
    expect(documentExportFilename('private.docx')).toBe('private.docx')
  })

  it('strips path segments, quotes, and missing extensions', () => {
    expect(documentExportFilename('a/../evil"name')).toBe('evilname.docx')
    expect(documentExportFilename('report.txt')).toBe('report.txt.docx')
    expect(documentExportFilename('')).toBe('document.docx')
    expect(documentExportFilename('bad\u0000name.docx')).toBe('badname.docx')
  })
})

describe('GET /api/documents/:id/export gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/export',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.binaryReads).toEqual([])
  })

  it('provisions an organisation for an org-less user before serving', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()

    const response = await routeApp(database, storage, {
      id: 'usr_viewer',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/export')

    expect(response.status).toBe(200)
    expect(database.transactionCommands).toContain('begin')
    expect(database.transactionCommands).toContain('commit')
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform 404 for a %s document without storage access',
    async (_name, id) => {
      const database = new TestDatabase()
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        `/api/documents/${id}/export`,
      )

      await expectDocument404(response)
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ access: null })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it.each([
    ['an absent current version', { currentVersion: false }],
    ['a processing current version', { status: 'processing' as const }],
  ])('returns the uniform 404 for %s', async (_name, options) => {
    const database = new TestDatabase(options)
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
  })

  it.each(['pdf', 'txt'])(
    'returns the uniform 404 for a ready %s version',
    async (fileType) => {
      const database = new TestDatabase({ fileType })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/export',
      )

      await expectDocument404(response)
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('returns the uniform 404 for an unknown versionId without storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export?versionId=ver_unknown',
    )

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
  })
})

describe('GET /api/documents/:id/export response', () => {
  it('returns the stored source bytes unchanged when there are no comments', async () => {
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )
    const bytes = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      DOCUMENT_EXPORT_CONTENT_TYPE,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="private.docx"',
    )
    expect(bytes.equals(sourceBytes)).toBe(true)
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(database.audits).toEqual([
      {
        entityType: 'document',
        entityId: 'doc_1',
        action: 'document.export',
        metadata: {
          matterId: 'mtr_1',
          versionId: 'ver_1',
          commentCount: 0,
        },
      },
    ])
    expect(JSON.stringify(database.audits)).not.toContain('private.docx')
    expect(database.queries.map(queryKind)).toEqual([
      'document',
      'versions',
      'current-version',
      'matter-access',
      'comments',
      'audit',
    ])
  })

  it('embeds listed comments into a Word comments part', async () => {
    const database = new TestDatabase({ access: 'view' })
    database.seedComment({
      paragraphId: fixtureParagraphId,
      body: 'Synthetic review note',
    })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )
    const bytes = Buffer.from(await response.arrayBuffer())
    const exported = await parseDocx(bytes)
    const commentsXml = new TextDecoder().decode(
      exported.sourceParts.get('word/comments.xml')?.originalPayload,
    )

    expect(response.status).toBe(200)
    expect(fixtureParagraphId.length).toBeGreaterThan(0)
    expect(bytes.equals(sourceBytes)).toBe(false)
    expect(commentsXml).toContain('Synthetic review note')
    expect(commentsXml).not.toContain('private.docx')
    expect(database.audits).toEqual([
      {
        entityType: 'document',
        entityId: 'doc_1',
        action: 'document.export',
        metadata: {
          matterId: 'mtr_1',
          versionId: 'ver_1',
          commentCount: 1,
        },
      },
    ])
    expect(JSON.stringify(database.audits)).not.toContain(
      'Synthetic review note',
    )
  })

  it('does not read storage when the comments query no longer sees the document', async () => {
    const database = new TestDatabase({ commentsDocumentMissing: true })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
    expect(database.audits).toEqual([])
  })

  it('fails closed on a poisoned object key without reading storage', async () => {
    const database = new TestDatabase({
      objectKey: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/text',
    })
    const storage = new MemoryStorage()
    const { app, errors } = routeApp(database, storage)
    const response = await app.request('/api/documents/doc_1/export')

    expect(response.status).toBe(500)
    expect(errors).toContain('The document could not be exported.')
    expect(storage.binaryReads).toEqual([])
    expect(database.audits).toEqual([])
  })
})
