import { readPackageImageParts, requestedImagePartName } from '@obiter/ooxml'
import { createDocumentObjectKey, type DocumentVersionRecord } from './database'
import { DocumentArtifactStoreError } from './document-artifact-store'
import type { StorageService } from './storage'

type DocumentMediaSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>
type ImagePart = { bytes: Uint8Array; contentType: string }

export type DocumentImagePartCache = Map<
  string,
  Promise<ReadonlyMap<string, ImagePart>>
>

export class DocumentMediaStoreError extends DocumentArtifactStoreError {
  constructor() {
    super('The document image could not be read.')
  }
}

export function createDocumentImagePartCache(): DocumentImagePartCache {
  return new Map()
}

export async function getDocumentImagePart(
  storage: StorageService,
  source: DocumentMediaSource,
  partName: string,
  cache: DocumentImagePartCache = createDocumentImagePartCache(),
) {
  const expectedSourceKey = createDocumentObjectKey({
    organisationId: source.organisationId,
    matterId: source.matterId,
    documentId: source.matterDocumentId,
    versionId: source.id,
  })
  if (source.objectKey !== expectedSourceKey)
    throw new DocumentMediaStoreError()

  const cacheKey = `${source.id}:${expectedSourceKey}`
  let pending = cache.get(cacheKey)
  if (!pending) {
    pending = loadVersionImageParts(storage, expectedSourceKey).catch(
      (error) => {
        cache.delete(cacheKey)
        throw error
      },
    )
    cache.set(cacheKey, pending)
  }
  return (await pending).get(requestedImagePartName(partName) ?? '')
}

async function loadVersionImageParts(
  storage: StorageService,
  objectKey: string,
) {
  try {
    if (!storage.readBinary) throw new DocumentMediaStoreError()
    const packageBytes = await storage.readBinary(objectKey)
    return await readPackageImageParts(packageBytes)
  } catch (error) {
    if (error instanceof DocumentMediaStoreError) throw error
    throw new DocumentMediaStoreError()
  }
}
