import type {
  DocumentEditRun,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type { OoxmlDocument, ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { escapeXmlAttribute, setOverlayReplacement } from './parts/overlay'
import { wordRunInnerTextXml } from './text-run-edit'

export function insertParagraphAfter(
  document: OoxmlDocument,
  story: DocumentModelWire['stories'][number],
  anchor: ParagraphAnchor,
  runs: readonly DocumentEditRun[],
  styleId: string | null | undefined,
  offset: number,
  xml: {
    prefix: string
    wrapRun?: (run: string) => string
  } = { prefix: 'w' },
) {
  const part = requireEditablePart(document, anchor.partName)
  const paragraphId = allocateModelId(document, 'para-edit')
  const wireRuns: DocumentTextRunWire[] = runs.map((run) => ({
    id: allocateModelId(document, 'text-edit'),
    ...(run.styleId ? { styleId: run.styleId } : {}),
    text: run.text,
    preservedXmlFragments: [],
  }))
  const paragraph: DocumentParagraphWire = {
    id: paragraphId,
    ...(styleId ? { styleId } : {}),
    runs: wireRuns,
    preservedXmlFragments: [],
  }
  const index = story.paragraphs.indexOf(anchor.wire)
  story.paragraphs.splice(index + 1 + offset, 0, paragraph)
  const properties = styleId
    ? `<${xml.prefix}:pPr><${xml.prefix}:pStyle ${xml.prefix}:val="${escapeXmlAttribute(styleId)}"/></${xml.prefix}:pPr>`
    : ''
  const runFragment = runs
    .map((run) => {
      const propertiesXml = insertRunPropertiesXml(xml.prefix, run)
      return `<${xml.prefix}:r>${propertiesXml}${wordRunInnerTextXml(xml.prefix, run.text)}</${xml.prefix}:r>`
    })
    .join('')
  setOverlayReplacement(part.overlay, `${paragraphId}:insert`, {
    start: anchor.paragraphRange.end,
    end: anchor.paragraphRange.end,
    value: `<${xml.prefix}:p>${properties}${xml.wrapRun?.(runFragment) ?? runFragment}</${xml.prefix}:p>`,
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

function insertRunPropertiesXml(prefix: string, run: DocumentEditRun) {
  const children: string[] = []
  if (run.styleId) {
    children.push(
      `<${prefix}:rStyle ${prefix}:val="${escapeXmlAttribute(run.styleId)}"/>`,
    )
  }
  if (run.bold === true) children.push(`<${prefix}:b/>`)
  if (run.bold === false) children.push(`<${prefix}:b ${prefix}:val="0"/>`)
  if (run.italic === true) children.push(`<${prefix}:i/>`)
  if (run.italic === false) children.push(`<${prefix}:i ${prefix}:val="0"/>`)
  if (run.underline === true) {
    children.push(`<${prefix}:u ${prefix}:val="single"/>`)
  }
  if (run.underline === false) {
    children.push(`<${prefix}:u ${prefix}:val="none"/>`)
  }
  return children.length === 0
    ? ''
    : `<${prefix}:rPr>${children.join('')}</${prefix}:rPr>`
}
