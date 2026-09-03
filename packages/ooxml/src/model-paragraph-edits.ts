import type {
  DocumentEditRun,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type { OoxmlDocument, ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import type { ParagraphFormat } from './model-property-edits'
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
    paragraphFormat?: ParagraphFormat
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
  const properties = insertParagraphPropertiesXml(
    xml.prefix,
    styleId,
    xml.paragraphFormat,
  )
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

export function allocateModelId(document: OoxmlDocument, prefix: string) {
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

function insertParagraphPropertiesXml(
  prefix: string,
  styleId: string | null | undefined,
  format: ParagraphFormat | undefined,
) {
  const children: string[] = []
  if (styleId) {
    children.push(
      `<${prefix}:pStyle ${prefix}:val="${escapeXmlAttribute(styleId)}"/>`,
    )
  }
  if (
    format?.spaceBefore != null ||
    format?.spaceAfter != null ||
    format?.lineSpacing
  ) {
    const attrs: string[] = []
    if (format.spaceBefore != null) {
      attrs.push(`${prefix}:before="${String(format.spaceBefore)}"`)
    }
    if (format.spaceAfter != null) {
      attrs.push(`${prefix}:after="${String(format.spaceAfter)}"`)
    }
    if (format.lineSpacing) {
      attrs.push(`${prefix}:line="${String(format.lineSpacing.line)}"`)
      if (format.lineSpacing.lineRule) {
        attrs.push(`${prefix}:lineRule="${format.lineSpacing.lineRule}"`)
      }
    }
    children.push(`<${prefix}:spacing ${attrs.join(' ')}/>`)
  }
  if (format?.indentation) {
    const indent = format.indentation
    const attrs: string[] = []
    for (const key of ['left', 'right', 'firstLine', 'hanging'] as const) {
      const value = indent[key]
      if (value != null) attrs.push(`${prefix}:${key}="${String(value)}"`)
    }
    if (attrs.length > 0) {
      children.push(`<${prefix}:ind ${attrs.join(' ')}/>`)
    }
  }
  if (format?.alignment) {
    children.push(
      `<${prefix}:jc ${prefix}:val="${escapeXmlAttribute(format.alignment)}"/>`,
    )
  }
  return children.length === 0
    ? ''
    : `<${prefix}:pPr>${children.join('')}</${prefix}:pPr>`
}

function insertRunPropertiesXml(prefix: string, run: DocumentEditRun) {
  const children: string[] = []
  if (run.styleId) {
    children.push(
      `<${prefix}:rStyle ${prefix}:val="${escapeXmlAttribute(run.styleId)}"/>`,
    )
  }
  if (run.fontFamily) {
    const name = escapeXmlAttribute(run.fontFamily)
    children.push(
      `<${prefix}:rFonts ${prefix}:ascii="${name}" ${prefix}:hAnsi="${name}"/>`,
    )
  }
  if (run.bold === true) children.push(`<${prefix}:b/>`)
  if (run.bold === false) children.push(`<${prefix}:b ${prefix}:val="0"/>`)
  if (run.italic === true) children.push(`<${prefix}:i/>`)
  if (run.italic === false) children.push(`<${prefix}:i ${prefix}:val="0"/>`)
  if (run.strikethrough === true) children.push(`<${prefix}:strike/>`)
  if (run.strikethrough === false) {
    children.push(`<${prefix}:strike ${prefix}:val="0"/>`)
  }
  if (run.smallCaps === true) children.push(`<${prefix}:smallCaps/>`)
  if (run.smallCaps === false) {
    children.push(`<${prefix}:smallCaps ${prefix}:val="0"/>`)
  }
  if (run.colour) {
    children.push(
      `<${prefix}:color ${prefix}:val="${escapeXmlAttribute(run.colour)}"/>`,
    )
  }
  if (run.fontSize != null) {
    children.push(`<${prefix}:sz ${prefix}:val="${String(run.fontSize)}"/>`)
    children.push(`<${prefix}:szCs ${prefix}:val="${String(run.fontSize)}"/>`)
  }
  if (run.highlight) {
    children.push(
      `<${prefix}:highlight ${prefix}:val="${escapeXmlAttribute(run.highlight)}"/>`,
    )
  }
  if (run.underline === true) {
    children.push(`<${prefix}:u ${prefix}:val="single"/>`)
  }
  if (run.underline === false) {
    children.push(`<${prefix}:u ${prefix}:val="none"/>`)
  }
  if (run.vertAlign) {
    children.push(
      `<${prefix}:vertAlign ${prefix}:val="${escapeXmlAttribute(run.vertAlign)}"/>`,
    )
  }
  return children.length === 0
    ? ''
    : `<${prefix}:rPr>${children.join('')}</${prefix}:rPr>`
}
