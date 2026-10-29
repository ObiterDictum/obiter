import { createDocumentObjectKey } from './document-database'
import { type DocumentVersionRecord } from './database-records'

type DocumentDerivedSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>

type DocumentDerivedName = 'text' | 'layout.json' | 'model.json'

export class DocumentDerivedStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export function deriveDocumentSiblingObjectKey(
  sourceObjectKey: string,
  file: DocumentDerivedName,
) {
  return sourceObjectKey.replace(/\/source$/u, `/${file}`)
}

export function validateAndDeriveDocumentObjectKey(
  source: DocumentDerivedSource,
  file: DocumentDerivedName,
  createError: () => DocumentDerivedStoreError,
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

  return deriveDocumentSiblingObjectKey(expectedSourceKey, file)
}
