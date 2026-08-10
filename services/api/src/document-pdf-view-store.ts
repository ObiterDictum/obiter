import { documentTextLayoutSchema } from '@obiter/contracts'
import { createDocumentObjectKey, type DocumentVersionRecord } from './database'
import type { StorageService } from './storage'

type DocumentPdfViewSource = Pick<
  DocumentVersionRecord,
  | 'id'
  | 'organisationId'
  | 'matterId'
  | 'matterDocumentId'
  | 'objectKey'
  | 'textObjectKey'
>

export class DocumentPdfViewStoreError extends Error {
  constructor() {
    super('The PDF view could not be read.')
    this.name = 'DocumentPdfViewStoreError'
  }
}

function derivePdfViewObjectKeys(source: DocumentPdfViewSource) {
  const segments = [
    source.organisationId,
    source.matterId,
    source.matterDocumentId,
    source.id,
  ]
  if (segments.some((segment) => segment.length === 0 || segment.includes('/')))
    throw new DocumentPdfViewStoreError()

  const expectedSourceKey = createDocumentObjectKey({
    organisationId: source.organisationId,
    matterId: source.matterId,
    documentId: source.matterDocumentId,
    versionId: source.id,
  })
  if (source.objectKey !== expectedSourceKey)
    throw new DocumentPdfViewStoreError()

  const textObjectKey = expectedSourceKey.replace(/\/source$/u, '/text')
  if (source.textObjectKey !== textObjectKey)
    throw new DocumentPdfViewStoreError()

  return {
    textObjectKey,
    layoutObjectKey: expectedSourceKey.replace(/\/source$/u, '/layout.json'),
  }
}

export async function getDocumentPdfView(
  storage: StorageService,
  source: DocumentPdfViewSource,
) {
  const { textObjectKey, layoutObjectKey } = derivePdfViewObjectKeys(source)

  try {
    const [text, layoutJson] = await Promise.all([
      storage.readText(textObjectKey),
      storage.readText(layoutObjectKey),
    ])
    const layout = documentTextLayoutSchema.parse(JSON.parse(layoutJson))
    return { text, layout }
  } catch {
    throw new DocumentPdfViewStoreError()
  }
}
