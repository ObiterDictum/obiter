import type { DocumentModelWire } from '@obiter/contracts'
import {
  DocumentDerivedStoreError,
  validateAndDeriveDocumentObjectKey,
} from './document-derived-store'
import type { DocumentVersionRecord } from './database-records'
import { runDocumentModelTask } from './document-model-pool'
import type { DocumentModelTaskResult } from './document-model-pool'
import type { StorageService } from './storage'

type DocumentModelSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

const inFlightModels = new Map<string, Promise<DocumentModelWire>>()

export class DocumentModelStoreError extends DocumentDerivedStoreError {
  constructor() {
    super('The document model could not be read.')
  }
}

function deriveDocumentModelObjectKey(source: DocumentModelSource) {
  return validateAndDeriveDocumentObjectKey(
    source,
    'model.json',
    () => new DocumentModelStoreError(),
  )
}

export async function getDocumentModel(
  storage: StorageService,
  source: DocumentModelSource,
) {
  const modelObjectKey = deriveDocumentModelObjectKey(source)
  const existing = inFlightModels.get(modelObjectKey)
  if (existing) return existing

  const model = readOrGenerateModel(storage, source.objectKey, modelObjectKey)
  inFlightModels.set(modelObjectKey, model)
  try {
    return await model
  } finally {
    if (inFlightModels.get(modelObjectKey) === model)
      inFlightModels.delete(modelObjectKey)
  }
}

async function readOrGenerateModel(
  storage: StorageService,
  sourceObjectKey: string,
  modelObjectKey: string,
) {
  let cachedJson: string | null = null
  try {
    cachedJson = await storage.readText(modelObjectKey)
  } catch (error) {
    if (!isMissingObject(error)) throw new DocumentModelStoreError()
  }

  if (cachedJson !== null) {
    let cached: DocumentModelTaskResult
    try {
      cached = await runDocumentModelTask({ kind: 'parse', json: cachedJson })
    } catch {
      throw new DocumentModelStoreError()
    }
    if (cached.status === 'ok') return cached.model
    if (cached.status === 'failed') throw new DocumentModelStoreError()
    // 'invalid': the cached model is unusable or from an older layout, so the
    // stored source regenerates it exactly as an absent cache would.
  }

  try {
    if (!storage.readBinary) throw new DocumentModelStoreError()
    const source = await storage.readBinary(sourceObjectKey)
    const generated = await runDocumentModelTask({
      kind: 'generate',
      bytes: source,
    })
    if (generated.status !== 'ok' || generated.json === null) {
      throw new DocumentModelStoreError()
    }
    await storage.writeText(modelObjectKey, generated.json)
    return generated.model
  } catch {
    throw new DocumentModelStoreError()
  }
}

function isMissingObject(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
