import type { DocumentModelWire } from '@obiter/contracts'
import {
  OoxmlError,
  parseDocx,
  parseModelJson,
  serialiseModelJson,
} from '@obiter/ooxml'
import type { DocumentVersionRecord } from './database'
import type { StorageService } from './storage'

type DocumentModelSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

const inFlightModels = new Map<string, Promise<DocumentModelWire>>()

export class DocumentModelStoreError extends Error {
  constructor() {
    super('The document model could not be read.')
    this.name = 'DocumentModelStoreError'
  }
}

export function deriveDocumentModelObjectKey(source: DocumentModelSource) {
  const segments = [
    source.organisationId,
    source.matterId,
    source.matterDocumentId,
    source.id,
  ]
  if (segments.some((segment) => segment.length === 0 || segment.includes('/')))
    throw new DocumentModelStoreError()

  const expectedSourceKey = `org/${source.organisationId}/matters/${source.matterId}/documents/${source.matterDocumentId}/versions/${source.id}/source`
  if (source.objectKey !== expectedSourceKey)
    throw new DocumentModelStoreError()

  return source.objectKey.replace(/\/source$/u, '/model.json')
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
    try {
      return parseModelJson(cachedJson)
    } catch (error) {
      if (
        !(error instanceof OoxmlError) ||
        error.code !== 'invalid-model-json'
      ) {
        throw new DocumentModelStoreError()
      }
    }
  }

  try {
    if (!storage.readBinary) throw new DocumentModelStoreError()
    const source = await storage.readBinary(sourceObjectKey)
    const json = serialiseModelJson(await parseDocx(source))
    await storage.writeText(modelObjectKey, json)
    return parseModelJson(json)
  } catch {
    throw new DocumentModelStoreError()
  }
}

function isMissingObject(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
