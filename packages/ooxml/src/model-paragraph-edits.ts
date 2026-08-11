import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type { OoxmlDocument, ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  escapeXmlAttribute,
  escapeXmlText,
  setOverlayReplacement,
} from './parts/overlay'

export function insertParagraphAfter(
  document: OoxmlDocument,
  story: DocumentModelWire['stories'][number],
  anchor: ParagraphAnchor,
  text: string,
  styleId: string | null | undefined,
  offset: number,
) {
  const part = requireEditablePart(document, anchor.partName)
  const paragraphId = allocateModelId(document, 'para-edit')
  const runId = allocateModelId(document, 'text-edit')
  const run: DocumentTextRunWire = {
    id: runId,
    text,
    preservedXmlFragments: [],
  }
  const paragraph: DocumentParagraphWire = {
    id: paragraphId,
    ...(styleId ? { styleId } : {}),
    runs: [run],
    preservedXmlFragments: [],
  }
  const index = story.paragraphs.indexOf(anchor.wire)
  story.paragraphs.splice(index + 1 + offset, 0, paragraph)
  const properties = styleId
    ? `<w:pPr><w:pStyle w:val="${escapeXmlAttribute(styleId)}"/></w:pPr>`
    : ''
  const xmlSpace = /^\s|\s$/u.test(text) ? ' xml:space="preserve"' : ''
  setOverlayReplacement(part.overlay, `${paragraphId}:insert`, {
    start: anchor.paragraphRange.end,
    end: anchor.paragraphRange.end,
    value: `<w:p>${properties}<w:r><w:t${xmlSpace}>${escapeXmlText(text)}</w:t></w:r></w:p>`,
  })
  part.dirty = true
}

export function deleteParagraph(
  document: OoxmlDocument,
  story: DocumentModelWire['stories'][number],
  anchor: ParagraphAnchor,
) {
  const part = requireEditablePart(document, anchor.partName)
  setOverlayReplacement(part.overlay, `${anchor.wire.id}:delete`, {
    start: anchor.paragraphRange.start,
    end: anchor.paragraphRange.end,
    value: '',
  })
  story.paragraphs.splice(story.paragraphs.indexOf(anchor.wire), 1)
  part.dirty = true
}

function allocateModelId(document: OoxmlDocument, prefix: string) {
  const used = new Set(
    document.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((paragraph) => [
        paragraph.id,
        ...paragraph.runs.map(({ id }) => id),
      ]),
    ),
  )
  let sequence = 1
  while (used.has(`${prefix}-${String(sequence).padStart(6, '0')}`)) {
    sequence += 1
  }
  return `${prefix}-${String(sequence).padStart(6, '0')}`
}
