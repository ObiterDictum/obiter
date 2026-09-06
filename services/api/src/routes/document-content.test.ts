import { documentTextResponseSchema } from '@obiter/contracts'
import { describe, expect, it } from 'vitest'
import {
  docxBytes,
  expectDocument404,
  MemoryStorage,
  odtBytes,
  pdfBytes,
  routeApp,
  TestDatabase,
  txtBytes,
  txtExtracted,
} from './document-content.test-support'

describe('GET /api/documents/:id/download gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase({ fileType: 'pdf' })
    const storage = new MemoryStorage({ binary: pdfBytes })
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/download',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.binaryReads).toEqual([])
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform 404 for a %s document without storage access',
    async (_name, id) => {
      const database = new TestDatabase({ fileType: 'pdf' })
      const storage = new MemoryStorage({ binary: pdfBytes })
      const response = await routeApp(database, storage).app.request(
        `/api/documents/${id}/download`,
      )

      await expectDocument404(response)
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ fileType: 'pdf', access: null })
    const storage = new MemoryStorage({ binary: pdfBytes })
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/download',
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
    ['a failed current version', { status: 'failed' as const }],
  ])('returns the uniform 404 for %s', async (_name, options) => {
    const database = new TestDatabase({ fileType: 'pdf', ...options })
    const storage = new MemoryStorage({ binary: pdfBytes })
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/download',
    )

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
  })

  it.each([
    [
      'docx',
      'private.docx',
      docxBytes,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['pdf', 'bundle.pdf', pdfBytes, 'application/pdf'],
    ['txt', 'notes.txt', txtBytes, 'text/plain;charset=utf-8'],
    ['other', 'legacy.odt', odtBytes, 'application/octet-stream'],
  ])(
    'returns the stored %s bytes with a download disposition',
    async (fileType, filename, bytes, contentType) => {
      const database = new TestDatabase({ fileType, filename })
      const storage = new MemoryStorage({ binary: bytes })
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/download',
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${filename}"`,
      )
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      await expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    },
  )

  it('fails closed when the stored bytes are missing', async () => {
    const database = new TestDatabase({ fileType: 'pdf' })
    const storage = new MemoryStorage({ binary: pdfBytes })
    storage.binary.clear()
    const { app, errors } = routeApp(database, storage)
    const response = await app.request('/api/documents/doc_1/download')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(errors).toEqual(['The document could not be downloaded.'])
  })
})

describe('GET /api/documents/:id/text gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase({ fileType: 'txt' })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/text',
    )

    expect(response.status).toBe(401)
    expect(database.queries).toEqual([])
    expect(storage.textReads).toEqual([])
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform 404 for a %s document without storage access',
    async (_name, id) => {
      const database = new TestDatabase({ fileType: 'txt' })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        `/api/documents/${id}/text`,
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
    },
  )

  it.each([
    ['a ready docx version', { fileType: 'docx', filename: 'private.docx' }],
    ['a ready pdf version', { fileType: 'pdf', filename: 'bundle.pdf' }],
    [
      'a processing txt version',
      { fileType: 'txt', filename: 'notes.txt', status: 'processing' as const },
    ],
    [
      'a failed txt version',
      { fileType: 'txt', filename: 'notes.txt', status: 'failed' as const },
    ],
  ])('returns the uniform 404 for %s', async (_name, options) => {
    const database = new TestDatabase(options)
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/text',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
  })

  it('returns the extracted text for a ready txt version', async () => {
    const database = new TestDatabase({
      fileType: 'txt',
      filename: 'notes.txt',
    })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/text',
    )

    expect(response.status).toBe(200)
    const parsed = documentTextResponseSchema.safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toMatchObject({
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
      text: txtExtracted,
    })
  })

  it('fails closed when the stored text is missing', async () => {
    const database = new TestDatabase({
      fileType: 'txt',
      filename: 'notes.txt',
    })
    const storage = new MemoryStorage()
    storage.text.clear()
    const { app, errors } = routeApp(database, storage)
    const response = await app.request('/api/documents/doc_1/text')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'storage_unavailable' },
    })
    expect(errors).toEqual(['The document text could not be read.'])
  })
})
