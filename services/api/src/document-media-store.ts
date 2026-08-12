import { readPackageImagePart } from '@obiter/ooxml'
import { createDocumentObjectKey, type DocumentVersionRecord } from './database'
import { DocumentArtifactStoreError } from './document-artifact-store'
import type { StorageService } from './storage'

type DocumentMediaSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

export class DocumentMediaStoreError extends DocumentArtifactStoreError {
  constructor() {
    super('The document image could not be read.')
  }
}

export async function getDocumentImagePart(
  storage: StorageService,
  source: DocumentMediaSource,
  partName: string,
) {
  const expectedSourceKey = createDocumentObjectKey({
    organisationId: source.organisationId,
    matterId: source.matterId,
    documentId: source.matterDocumentId,
    versionId: source.id,
  })
  if (source.objectKey !== expectedSourceKey)
    throw new DocumentMediaStoreError()

  try {
    if (!storage.readBinary) throw new DocumentMediaStoreError()
    const packageBytes = await storage.readBinary(expectedSourceKey)
    return await readPackageImagePart(packageBytes, partName)
  } catch (error) {
    if (error instanceof DocumentMediaStoreError) throw error
    throw new DocumentMediaStoreError()
  }
}
