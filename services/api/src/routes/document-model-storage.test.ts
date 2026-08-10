import { documentModelResponseSchema } from '@obiter/contracts'
import { parseModelJson } from '@obiter/ooxml'
import { describe, expect, it, vi } from 'vitest'
import {
  cachedModelJson,
  MemoryStorage,
  modelObjectKey,
  queryKind,
  routeApp,
  sourceObjectKey,
  TestDatabase,
} from './document-model.test-support'

describe('GET /api/documents/:id/model storage boundary', () => {
  it('serves a validated cache hit to a view grantee with only wrapper fields', async () => {
    const database = new TestDatabase({ accessLevel: 'view' })
    const storage = new MemoryStorage()
    storage.text.set(modelObjectKey, cachedModelJson)

    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )
    const body = documentModelResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
      model: parseModelJson(cachedModelJson),
    })
    expect(Object.keys(body)).toEqual([
      'documentId',
      'versionId',
      'versionNumber',
      'model',
    ])
    expect(JSON.stringify(body)).not.toContain('objectKey')
    expect(JSON.stringify(body)).not.toContain('private.docx')
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([])
    expect(database.queries.map(queryKind)).toEqual([
      'document',
      'versions',
      'current-version',
      'matter-access',
    ])
  })

  it('generates a missing cache from the immutable source at the exact derived key', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()

    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )

    expect(response.status).toBe(200)
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toEqual([
      { key: modelObjectKey, text: cachedModelJson },
    ])
    expect(parseModelJson(storage.text.get(modelObjectKey) ?? '')).toEqual(
      parseModelJson(cachedModelJson),
    )
  })

  it.each([
    ['malformed JSON', '{malformed cache'],
    ['an invalid wire value', JSON.stringify({ version: 1, stories: 'no' })],
  ])(
    'regenerates and replaces cached model JSON containing %s',
    async (_name, cachedJson) => {
      const database = new TestDatabase()
      const storage = new MemoryStorage()
      storage.text.set(modelObjectKey, cachedJson)

      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/model',
      )

      expect(response.status).toBe(200)
      expect(storage.binaryReads).toEqual([sourceObjectKey])
      expect(storage.text.get(modelObjectKey)).toBe(cachedModelJson)
    },
  )

  it('coalesces concurrent generation within the process', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    let releaseBinary: () => void = () => undefined
    storage.binaryGate = new Promise<void>((resolve) => {
      releaseBinary = resolve
    })
    const app = routeApp(database, storage).app

    const first = app.request('/api/documents/doc_1/model')
    const second = app.request('/api/documents/doc_1/model')
    await vi.waitFor(() => expect(storage.binaryReads).toHaveLength(1))
    releaseBinary()

    const responses = await Promise.all([first, second])
    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toHaveLength(1)
  })

  it('retries the miss path after a derived cache write fails', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.writeTextError = new Error('private write diagnostic')
    const { app, errors } = routeApp(database, storage)

    const failedResponse = await app.request('/api/documents/doc_1/model')

    expect(failedResponse.status).toBe(500)
    expect(failedResponse.headers.get('cache-control')).toBe('no-store')
    expect(await failedResponse.text()).not.toContain(
      'private write diagnostic',
    )
    expect(errors).toEqual(['The document model could not be read.'])
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([sourceObjectKey])

    storage.writeTextError = null
    const retryResponse = await app.request('/api/documents/doc_1/model')

    expect(retryResponse.status).toBe(200)
    expect(storage.textReads).toEqual([modelObjectKey, modelObjectKey])
    expect(storage.binaryReads).toEqual([sourceObjectKey, sourceObjectKey])
    expect(storage.textWrites).toHaveLength(2)
  })

  it('does not convert non-missing storage failures into cache misses', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.readTextError = Object.assign(
      new Error('EACCES diagnostic for a private object path'),
      { code: 'EACCES' },
    )
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(storage.binaryReads).toEqual([])
    expect(body).not.toContain('EACCES')
    expect(errors).toEqual(['The document model could not be read.'])
  })

  it('keeps source parser diagnostics behind the generic API boundary', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.binary.set(sourceObjectKey, Buffer.from('PK private parser marker'))
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).not.toContain('parser marker')
    expect(errors).toEqual(['The document model could not be read.'])
  })

  it('refuses a quarantine source key before any storage read', async () => {
    const database = new TestDatabase({
      objectKey: 'org/org_1/quarantine/private/source',
    })
    const storage = new MemoryStorage()
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(storage.textReads).toEqual([])
    expect(storage.binaryReads).toEqual([])
    expect(errors.join(' ')).not.toContain('quarantine')
  })
})
