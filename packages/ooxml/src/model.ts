import {
  documentEditOperationSchema,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

import type { XmlOverlay } from './parts/overlay'
import { replaceTextRunAtAnchor } from './text-run-edit'

export type SourcePartKind = 'xml' | 'binary'
export type SourcePartRole =
  | 'story'
  | 'styles'
  | 'numbering'
  | 'relationships'
  | 'content-types'
  | 'opaque'

export type TrackedChangeOverlay = {
  elementName: 'ins' | 'del' | 'moveFrom' | 'moveTo' | 'pPrChange' | 'rPrChange'
  author?: string
  date?: string
  sourceFragment: string
}

export type SourcePart = {
  name: string
  kind: SourcePartKind
  role: SourcePartRole
  originalPayload: Uint8Array
  dirty: boolean
  overlay?: XmlOverlay
  trackedChanges: TrackedChangeOverlay[]
}

export type ModelIdAllocator = {
  nextParagraphId(): string
  nextTextRunId(): string
}

export type ParseDocxOptions = {
  idAllocator?: ModelIdAllocator
}

type TextRange = { start: number; end: number }
export type XmlElementRange = TextRange & {
  startTagEnd: number
  endTagStart: number
}
export type TextRunAnchor = {
  partName: string
  wire: DocumentTextRunWire
  runRange: XmlElementRange
  textRanges: TextRange[]
  textElements: XmlElementRange[]
  runProperties: string[]
  runPropertiesRange?: XmlElementRange
  runStyleRange?: XmlElementRange
}
export type ParagraphAnchor = {
  partName: string
  wire: DocumentParagraphWire
  paragraphRange: XmlElementRange
  paragraphPropertiesRange?: XmlElementRange
  paragraphStyleRange?: XmlElementRange
  hasTrackedChanges: boolean
  runs: TextRunAnchor[]
}

export type OoxmlDocument = {
  model: DocumentModelWire
  sourceParts: Map<string, SourcePart>
  textRunAnchors: Map<string, TextRunAnchor>
  paragraphAnchors: Map<string, ParagraphAnchor>
}

export function createSequentialModelIdAllocator(start = 1): ModelIdAllocator {
  let paragraph = start
  let textRun = start
  return {
    nextParagraphId() {
      const id = `para-${String(paragraph).padStart(6, '0')}`
      paragraph += 1
      return id
    },
    nextTextRunId() {
      const id = `text-${String(textRun).padStart(6, '0')}`
      textRun += 1
      return id
    },
  }
}

export function replaceTextRunText(
  document: OoxmlDocument,
  textRunId: string,
  text: string,
) {
  const operation = documentEditOperationSchema.safeParse({
    type: 'replace_run_text',
    runId: textRunId,
    text,
  })
  if (!operation.success) throw new OoxmlError('invalid-document-edit')
  const anchor = document.textRunAnchors.get(textRunId)
  if (!anchor) throw new OoxmlError('model-node-not-found')
  if (!replaceTextRunAtAnchor(document, anchor, text)) {
    throw new OoxmlError('model-node-not-editable')
  }
}

export { applyDocumentEdits } from './model-edits'

export type OoxmlErrorCode =
  | 'invalid-package'
  | 'invalid-xml-part'
  | 'model-node-not-found'
  | 'model-node-not-editable'
  | 'invalid-document-edit'
  | 'invalid-model-json'
  | 'comment-anchor-unresolved'
  | 'comment-export-failed'
  | 'serialisation-failed'

export class OoxmlError extends Error {
  readonly code: OoxmlErrorCode

  constructor(code: OoxmlErrorCode) {
    super(errorMessage(code))
    this.name = 'OoxmlError'
    this.code = code
  }
}

function errorMessage(code: OoxmlErrorCode) {
  if (code === 'invalid-package') return 'The document package is invalid.'
  if (code === 'invalid-xml-part') return 'The document contains invalid XML.'
  if (code === 'model-node-not-found') return 'The document node was not found.'
  if (code === 'model-node-not-editable') {
    return 'The document node cannot be edited.'
  }
  if (code === 'invalid-document-edit') {
    return 'The document edit is invalid.'
  }
  if (code === 'invalid-model-json') {
    return 'The document model JSON is invalid.'
  }
  if (code === 'comment-anchor-unresolved') {
    return 'A document comment anchor could not be resolved.'
  }
  if (code === 'comment-export-failed') {
    return 'The document comments could not be exported.'
  }
  return 'The document could not be serialised.'
}
