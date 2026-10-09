import { parseDocx, serialiseDocxWithComments } from '@obiter/ooxml'
import { describe, expect, it } from 'bun:test'
import {
  DOCUMENT_EXPORT_CONTENT_TYPE,
  documentExportFilename,
  shareSafeExportFilename,
} from '../document-export'
import { DOWNLOAD_FILENAME_MAX_LENGTH } from '../download-filename'
import { importedCommentFingerprint } from '../imported-comment-fingerprint'
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

describe('shareSafeExportFilename', () => {
  it('keeps the share-safe marker when the stem needs truncating', () => {
    const name = shareSafeExportFilename(`${'a'.repeat(300)}.docx`)
    expect(name).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH)
    expect(name.endsWith('-share-safe.docx')).toBe(true)
  })

  it('appends the share-safe marker for an ordinary name', () => {
    expect(shareSafeExportFilename('letter.docx')).toBe(
      'letter-share-safe.docx',
    )
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
    expect(database.queries.some((sql) => sql.includes('matter_shares'))).toBe(
      true,
    )
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
    expect(response.headers.get('x-obiter-comments-skipped')).toBeNull()
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
          shareSafe: false,
          commentCount: 0,
          skippedCommentCount: 0,
        },
      },
    ])
    expect(JSON.stringify(database.audits)).not.toContain('private.docx')
    expect(database.queries.map(queryKind)).toEqual([
      'document-access',
      'versions',
      'current-version',
      'comments',
      'comment-replies',
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
          shareSafe: false,
          commentCount: 1,
          skippedCommentCount: 0,
        },
      },
    ])
    expect(JSON.stringify(database.audits)).not.toContain(
      'Synthetic review note',
    )
  })

  it('skips comments whose anchors do not resolve and surfaces the count', async () => {
    const database = new TestDatabase({ access: 'view' })
    database.seedComment({
      paragraphId: fixtureParagraphId,
      body: 'Resolvable review note',
    })
    database.seedComment({
      paragraphId: 'para-gone',
      body: 'Stale review note',
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
    expect(response.headers.get('x-obiter-comments-skipped')).toBe('1')
    expect(commentsXml).toContain('Resolvable review note')
    expect(commentsXml).not.toContain('Stale review note')
    expect(database.audits).toEqual([
      {
        entityType: 'document',
        entityId: 'doc_1',
        action: 'document.export',
        metadata: {
          matterId: 'mtr_1',
          versionId: 'ver_1',
          shareSafe: false,
          commentCount: 2,
          skippedCommentCount: 1,
        },
      },
    ])
  })

  it('counts replies dropped with a skipped comment', async () => {
    const database = new TestDatabase({ access: 'view' })
    const skipped = database.seedComment({
      paragraphId: 'para-gone',
      body: 'Stale review note',
    })
    database.seedReply({ commentId: skipped.id, body: 'First reply' })
    database.seedReply({ commentId: skipped.id, body: 'Second reply' })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )

    expect(response.status).toBe(200)
    // One unresolvable comment plus its two replies that cannot embed.
    expect(response.headers.get('x-obiter-comments-skipped')).toBe('3')
  })

  it('threads a reply under a fingerprint-matched imported head', async () => {
    const commented = await fixtureWithComment()
    const importedHead = commented.model.comments.find(
      (entry) => entry.ooxmlId !== null,
    )
    if (!importedHead || !importedHead.paraId) {
      throw new Error('Fixture did not produce a threaded imported head.')
    }
    const database = new TestDatabase({ access: 'view' })
    database.seedReply({
      importedCommentId: importedHead.id,
      importedParentFingerprint: importedCommentFingerprint(importedHead),
      body: 'Product reply on the file thread',
    })
    const storage = new MemoryStorage(commented.bytes)
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )
    const bytes = Buffer.from(await response.arrayBuffer())
    const exported = await parseDocx(bytes)
    const extendedXml = new TextDecoder().decode(
      exported.sourceParts.get('word/commentsExtended.xml')?.originalPayload,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-obiter-comments-skipped')).toBeNull()
    expect(extendedXml).toContain(`paraIdParent="${importedHead.paraId}"`)
  })

  it('counts imported replies whose head is absent or no longer matches', async () => {
    const commented = await fixtureWithComment()
    const importedHead = commented.model.comments.find(
      (entry) => entry.ooxmlId !== null,
    )
    if (!importedHead) {
      throw new Error('Fixture did not produce an imported head.')
    }
    const database = new TestDatabase({ access: 'view' })
    database.seedReply({
      importedCommentId: importedHead.id,
      importedParentFingerprint: 'f'.repeat(64),
      body: 'Written against a thread this w:id no longer holds',
    })
    database.seedReply({
      importedCommentId: 'ooxml-99',
      importedParentFingerprint: 'e'.repeat(64),
      body: 'Written against a thread this version lost',
    })
    const storage = new MemoryStorage(commented.bytes)
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )
    const bytes = Buffer.from(await response.arrayBuffer())
    const exported = await parseDocx(bytes)
    const commentsXml = new TextDecoder().decode(
      exported.sourceParts.get('word/comments.xml')?.originalPayload,
    )
    const extendedXml = new TextDecoder().decode(
      exported.sourceParts.get('word/commentsExtended.xml')?.originalPayload,
    )

    expect(response.status).toBe(200)
    // Both replies export unanchored rather than attaching to the wrong or
    // absent thread, and each is counted so the caller knows.
    expect(response.headers.get('x-obiter-comments-skipped')).toBe('2')
    expect(commentsXml).toContain(
      'Written against a thread this w:id no longer holds',
    )
    expect(commentsXml).toContain('Written against a thread this version lost')
    expect(extendedXml).not.toContain('paraIdParent')
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

/**
 * A fixture that carries an imported comment thread: the export writer
 * embeds a resolved comment (resolved so it is allocated a paraId), then the
 * package is re-parsed so its comments surface as imported `ooxml-<w:id>`
 * entries with their own threading identity.
 */
async function fixtureWithComment() {
  const source = await parseDocx(sourceBytes)
  const bytes = await serialiseDocxWithComments(source, [
    {
      id: 'cmt_source',
      documentId: 'doc_1',
      anchorVersionId: 'ver_1',
      anchor: { paragraphId: fixtureParagraphId, startOffset: 0, endOffset: 1 },
      body: 'File-carried thread head',
      author: { id: 'usr_owner', name: 'Owner Reviewer' },
      resolvedAt: '2026-08-10T12:00:00.000Z',
      resolvedBy: 'usr_owner',
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
      replies: [],
      anchorResolved: true,
    },
  ])
  return { bytes, model: (await parseDocx(bytes)).model }
}
