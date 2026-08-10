import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'

import {
  escapeXmlText,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'

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
export type TextRunAnchor = {
  partName: string
  wire: DocumentTextRunWire
  textRanges: TextRange[]
}

export type OoxmlDocument = {
  model: DocumentModelWire
  sourceParts: Map<string, SourcePart>
  textRunAnchors: Map<string, TextRunAnchor>
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
  const anchor = document.textRunAnchors.get(textRunId)
  if (!anchor) throw new OoxmlError('model-node-not-found')
  const part = document.sourceParts.get(anchor.partName)
  const overlay = part?.overlay
  if (!part || !overlay) throw new OoxmlError('model-node-not-found')
  if (anchor.textRanges.length === 0) {
    throw new OoxmlError('model-node-not-editable')
  }

  anchor.textRanges.forEach((range, index) => {
    setOverlayReplacement(overlay, `${textRunId}:${index}`, {
      ...range,
      value: index === 0 ? escapeXmlText(text) : '',
    })
  })
  anchor.wire.text = text
  part.dirty = true
}

export type OoxmlErrorCode =
  | 'invalid-package'
  | 'invalid-xml-part'
  | 'model-node-not-found'
  | 'model-node-not-editable'
  | 'invalid-model-json'
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
  if (code === 'invalid-model-json') {
    return 'The document model JSON is invalid.'
  }
  return 'The document could not be serialised.'
}
