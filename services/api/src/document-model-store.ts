import type { DocumentModelWire } from '@obiter/contracts'
import {
  OoxmlError,
  parseDocx,
  parseModelJson,
  serialiseModelJson,
} from '@obiter/ooxml'
import {
  DocumentArtifactStoreError,
  validateAndDeriveDocumentObjectKey,
} from './document-artifact-store'
import type { DocumentVersionRecord } from './database'
import type { StorageService } from './storage'

type DocumentModelSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

const inFlightModels = new Map<string, Promise<DocumentModelWire>>()

export class DocumentModelStoreError extends DocumentArtifactStoreError {
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
    try {
      if (cachedModelNeedsRegeneration(cachedJson)) {
        throw new OoxmlError('invalid-model-json')
      }
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

function cachedModelNeedsRegeneration(json: string) {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null) return false
    if (!Object.hasOwn(value, 'changes')) return true
    const numbering = Object.hasOwn(value, 'numbering')
      ? Reflect.get(value, 'numbering')
      : undefined
    if (!Array.isArray(numbering)) return false
    return numbering.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        Object.hasOwn(item, 'numberingId') &&
        !Object.hasOwn(item, 'levels'),
    )
  } catch {
    // Defer malformed JSON to parseModelJson and its curated invalid-model path.
    return false
  }
}

function isMissingObject(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
