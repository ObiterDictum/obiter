import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'
import { parseDocx, parseModelJson, serialiseModelJson } from '@obiter/ooxml'
import {
  DocumentModelStoreError,
  getDocumentModel,
} from './document-model-store'
import { closeDocumentModelWorkers } from './document-model-pool'
import {
  MemoryStorage,
  modelObjectKey,
  sourceObjectKey,
} from './routes/document-route.test-support'

const source = {
  id: 'ver_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  matterDocumentId: 'doc_1',
  objectKey: sourceObjectKey,
}

const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
const oracleJson = serialiseModelJson(await parseDocx(fixture))
const oracleModel = parseModelJson(oracleJson)

function storageWithSource(): MemoryStorage {
  return new MemoryStorage({ binary: [[sourceObjectKey, fixture]] })
}

describe('getDocumentModel through the worker pool', () => {
  it('generates a missing model from the stored source and persists it', async () => {
    const storage = storageWithSource()

    const model = await getDocumentModel(storage, source)

    expect(model).toEqual(oracleModel)
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toEqual([
      { key: modelObjectKey, text: oracleJson },
    ])
  }, 20_000)

  it('serves a valid cached model without touching the source', async () => {
    const storage = new MemoryStorage()
    storage.text.set(modelObjectKey, oracleJson)

    const model = await getDocumentModel(storage, source)

    expect(model).toEqual(oracleModel)
    expect(storage.binaryReads).toEqual([])
    expect(storage.textWrites).toEqual([])
  }, 20_000)

  it('regenerates when the cached model is unusable', async () => {
    const storage = storageWithSource()
    storage.text.set(modelObjectKey, '{malformed cache')

    const model = await getDocumentModel(storage, source)

    expect(model).toEqual(oracleModel)
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toEqual([
      { key: modelObjectKey, text: oracleJson },
    ])
  }, 20_000)

  it('reports the curated store error when the source cannot be read', async () => {
    const storage = new MemoryStorage({ binary: [] })

    await expect(getDocumentModel(storage, source)).rejects.toBeInstanceOf(
      DocumentModelStoreError,
    )
  }, 20_000)

  it('shares one in-flight load between concurrent requests for the same version', async () => {
    const storage = storageWithSource()

    const [first, second] = await Promise.all([
      getDocumentModel(storage, source),
      getDocumentModel(storage, source),
    ])

    expect(first).toEqual(oracleModel)
    expect(second).toEqual(oracleModel)
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toHaveLength(1)
  }, 20_000)

  // Last in the file: it closes the shared pool, so nothing after it may load
  // a model in this module registry (the runner isolates files, not test cases).
  it('reports the curated store error once the pool has shut down', async () => {
    await closeDocumentModelWorkers()

    await expect(
      getDocumentModel(storageWithSource(), source),
    ).rejects.toBeInstanceOf(DocumentModelStoreError)
  }, 20_000)
})
