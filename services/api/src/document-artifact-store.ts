import { createDocumentObjectKey, type DocumentVersionRecord } from './database'

type DocumentArtifactSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

type DocumentArtifactName = 'text' | 'layout.json' | 'model.json'

export class DocumentArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export function deriveDocumentSiblingObjectKey(
  sourceObjectKey: string,
  artifact: DocumentArtifactName,
) {
  return sourceObjectKey.replace(/\/source$/u, `/${artifact}`)
}

export function validateAndDeriveDocumentObjectKey(
  source: DocumentArtifactSource,
  artifact: DocumentArtifactName,
  createError: () => DocumentArtifactStoreError,
) {
  const segments = [
    source.organisationId,
    source.matterId,
    source.matterDocumentId,
    source.id,
  ]
  if (segments.some((segment) => segment.length === 0 || segment.includes('/')))
    throw createError()

  const expectedSourceKey = createDocumentObjectKey({
    organisationId: source.organisationId,
    matterId: source.matterId,
    documentId: source.matterDocumentId,
    versionId: source.id,
  })
  if (source.objectKey !== expectedSourceKey) throw createError()

  return deriveDocumentSiblingObjectKey(expectedSourceKey, artifact)
}
