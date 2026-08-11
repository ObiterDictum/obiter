import { describe, expect, it } from 'vitest'
import {
  cachedModelJson,
  expectDocument404,
  MemoryStorage,
  modelObjectKey,
  routeApp,
  TestDatabase,
} from './document-model.test-support'

describe('GET /api/documents/:id/model gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/model',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.textReads).toEqual([])
  })

  it('provisions an organisation for an org-less user before serving', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.text.set(modelObjectKey, cachedModelJson)

    const response = await routeApp(database, storage, {
      id: 'usr_viewer',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/model')

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
        `/api/documents/${id}/model`,
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ access: null })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it.each([
    ['an absent current version', { currentVersion: false }],
    ['a processing current version', { status: 'processing' as const }],
  ])('returns the uniform 404 for %s', async (_name, options) => {
    const database = new TestDatabase(options)
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
  })

  it.each(['pdf', 'txt'])(
    'returns the uniform 404 for a ready %s version',
    async (fileType) => {
      const database = new TestDatabase({ fileType })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/model',
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
    },
  )
})
