import { documentPdfViewResponseSchema } from '@obiter/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  expectDocument404,
  extractedText,
  layout,
  layoutObjectKey,
  MemoryStorage,
  routeApp,
  TestDatabase,
  textObjectKey,
} from './document-pdf-view.test-support'

describe('GET /api/documents/:id/pdf-view gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/pdf-view',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.textReads).toEqual([])
  })

  it('provisions an organisation for an org-less user before serving', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, {
      id: 'usr_reader',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/pdf-view')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.transactionCommands).toContain('begin')
    expect(database.transactionCommands).toContain('commit')
  })

  it('preserves workspace preparation failure without reading storage', async () => {
    const database = new TestDatabase({ provisionFails: true })
    const storage = new MemoryStorage()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await routeApp(database, storage, {
      id: 'usr_reader',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/pdf-view')
    consoleError.mockRestore()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.textReads).toEqual([])
    expect(await response.text()).not.toContain(
      'private provisioning diagnostic',
    )
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
        `/api/documents/${id}/pdf-view`,
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ access: null })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/pdf-view',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it.each([
    ['an absent current version', { currentVersion: false }],
    ['a missing current pointer', { currentVersionId: null }],
    ['a mismatched current pointer', { currentVersionId: 'ver_other' }],
    [
      'a cross-organisation current version',
      { versionOrganisationId: 'org_other' },
    ],
    ['a cross-matter current version', { versionMatterId: 'mtr_other' }],
    ['a cross-document current version', { versionDocumentId: 'doc_other' }],
    ['a processing current version', { status: 'processing' as const }],
  ])('returns the uniform 404 for %s', async (_name, options) => {
    const database = new TestDatabase(options)
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/pdf-view',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it.each(['docx', 'txt'])(
    'returns the uniform 404 for a ready %s version',
    async (fileType) => {
      const database = new TestDatabase({ fileType })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/pdf-view',
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
      expect(database.queries.at(-1)).toContain('left join matter_shares')
    },
  )
})

describe('GET /api/documents/:id/pdf-view response', () => {
  it.each(['owner', 'view', 'edit'] as const)(
    'serves a validated read-only view to a matter %s reader',
    async (access) => {
      const database = new TestDatabase({ access })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/pdf-view',
      )
      const rawBody = await response.json()
      const body = documentPdfViewResponseSchema.parse(rawBody)

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body).toEqual({
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        text: extractedText,
        layout,
      })
      expect(Object.keys(body)).toEqual([
        'documentId',
        'versionId',
        'versionNumber',
        'text',
        'layout',
      ])
      expect(JSON.stringify(rawBody)).not.toMatch(
        /objectKey|textObjectKey|source|quarantine|document\.pdf/u,
      )
      expect(storage.textReads).toEqual([textObjectKey, layoutObjectKey])
      expect(storage.textWrites).toEqual([])
      expect(storage.deletes).toEqual([])
    },
  )

  it('validates the complete response wrapper before returning it', async () => {
    const database = new TestDatabase({ versionNumber: 0 })
    const storage = new MemoryStorage()
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/pdf-view')

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(errors).toEqual(['The PDF view could not be read.'])
  })

  it('keeps stored layout diagnostics behind the generic API boundary', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.text.set(layoutObjectKey, '{private layout diagnostic')
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/pdf-view')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).not.toContain('private layout diagnostic')
    expect(errors).toEqual(['The PDF view could not be read.'])
  })
})
