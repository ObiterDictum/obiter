import { parseDocx } from '@obiter/ooxml'
import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import {
  MemoryStorage,
  routeApp,
  sourceBytes,
  TestDatabase,
} from './document-export.test-support'

describe('GET /api/documents/:id/export?mode=share-safe', () => {
  it('rejects an unknown export mode before touching the database', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export?mode=admin',
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(database.queries).toEqual([])
    expect(storage.binaryReads).toEqual([])
  })

  it('serves the sanitised package under a share-safe filename', async () => {
    const database = new TestDatabase({ access: 'view' })
    database.seedComment({ body: 'Internal-only review note' })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export?mode=share-safe',
    )
    const bytes = Buffer.from(await response.arrayBuffer())
    const exported = await parseDocx(bytes)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="private-share-safe.docx"',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // Product comments never entered the package — they were not listed, and
    // the sanitizer verifies the artifact has no comments surface anyway.
    expect(
      new TextDecoder().decode(
        exported.sourceParts.get('word/comments.xml')?.originalPayload,
      ),
    ).not.toContain('Internal-only review note')
    expect(database.audits).toEqual([
      {
        entityType: 'document',
        entityId: 'doc_1',
        action: 'document.export',
        metadata: {
          matterId: 'mtr_1',
          versionId: 'ver_1',
          shareSafe: true,
          commentCount: 0,
          skippedCommentCount: 0,
        },
      },
    ])
    expect(JSON.stringify(database.audits)).not.toContain(
      'Internal-only review note',
    )
  })

  it('refuses a version carrying tracked changes and audits nothing', async () => {
    const tracked = await trackedChangesDocx()
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(tracked)
    const { app } = routeApp(database, storage)
    const response = await app.request(
      '/api/documents/doc_1/export?mode=share-safe',
    )

    expect(response.status).toBe(422)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({
      error: { code: 'share_safe_export_refused' },
    })
    expect(database.audits).toEqual([])
    // The response is the error envelope, not document bytes: the refusal is
    // a JSON body well under the source package's size.
    expect(body.length).toBeLessThan(tracked.byteLength)
  })

  // Real-toolchain corpus: ordinary Word output must export, not refuse.
  it.each([
    'letter-plain.docx',
    'letter-table.docx',
    'letter-footnotes-numbering.docx',
    'letter-image.docx',
  ])('exports the real-toolchain corpus doc %s', async (filename) => {
    const bytes = await readFile(`test-fixtures/upload-corpus/${filename}`)
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(new Uint8Array(bytes))
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export?mode=share-safe',
    )

    expect(response.status).toBe(200)
    const exported = await parseDocx(
      new Uint8Array(await response.arrayBuffer()),
    )
    expect(exported.model.changes).toHaveLength(0)
    expect(exported.model.comments).toHaveLength(0)
  })

  it('refuses the tracked-changes corpus doc', async () => {
    const bytes = await readFile(
      'test-fixtures/upload-corpus/letter-tracked-changes.docx',
    )
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(new Uint8Array(bytes))
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export?mode=share-safe',
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'share_safe_export_refused' },
    })
  })

  it('carries a faithful Unicode name through filename*', async () => {
    const database = new TestDatabase({
      access: 'view',
      filename: 'plädoyer — été.docx',
    })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/export',
    )

    expect(response.status).toBe(200)
    const disposition = response.headers.get('content-disposition')
    expect(disposition).toContain('filename="pl_doyer _ _t_.docx"')
    expect(disposition).toContain(
      "filename*=UTF-8''pl%C3%A4doyer%20%E2%80%94%20%C3%A9t%C3%A9.docx",
    )
  })
})

/** The demo fixture plus one tracked insertion — share-safe must refuse it. */
async function trackedChangesDocx() {
  const zip = await JSZip.loadAsync(sourceBytes)
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('Fixture story is missing.')
  zip.file(
    'word/document.xml',
    (await document.async('string')).replace(
      '<w:r><w:t xml:space="preserve">IN THE HIGH COURT OF JUSTICE</w:t></w:r>',
      '<w:ins w:id="9" w:author="Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t xml:space="preserve">IN THE HIGH COURT OF JUSTICE</w:t></w:r></w:ins>',
    ),
  )
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
