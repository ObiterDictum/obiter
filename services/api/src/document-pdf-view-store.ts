import { documentTextLayoutSchema } from '@obiter/contracts'
import {
  deriveDocumentSiblingObjectKey,
  DocumentArtifactStoreError,
  validateAndDeriveDocumentObjectKey,
} from './document-artifact-store'
import type { DocumentVersionRecord } from './database'
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

export class DocumentPdfViewStoreError extends DocumentArtifactStoreError {
  constructor() {
    super('The PDF view could not be read.')
  }
}

function derivePdfViewObjectKeys(source: DocumentPdfViewSource) {
  const textObjectKey = validateAndDeriveDocumentObjectKey(
    source,
    'text',
    () => new DocumentPdfViewStoreError(),
  )
  if (source.textObjectKey !== textObjectKey)
    throw new DocumentPdfViewStoreError()

  return {
    textObjectKey,
    layoutObjectKey: deriveDocumentSiblingObjectKey(
      source.objectKey,
      'layout.json',
    ),
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
