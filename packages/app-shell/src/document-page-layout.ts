import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { activeSectionXml, resolveRelationshipTarget } from '@obiter/ooxml'
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  twipToPx,
  xmlAttr,
  xmlNumber,
  xmlTagAttrs,
} from './document-page-units'

export type PageBox = {
  widthPx: number
  heightPx: number
  margin: { top: number; right: number; bottom: number; left: number }
  headerPx: number
  footerPx: number
}

export type ContentFrame = {
  top: number
  right: number
  bottom: number
  left: number
  widthPx: number
  heightPx: number
}

export type ColumnFrame = {
  left: number
  widthPx: number
}

const DEFAULT_MARGIN_PX = 96
const DEFAULT_HEADER_PX = 48

export function contentFrame(
  box: PageBox,
  bands?: { headerPx?: number; footerPx?: number },
): ContentFrame {
  const top = Math.max(box.margin.top, bands?.headerPx ?? 0)
  const bottom = Math.max(box.margin.bottom, bands?.footerPx ?? 0)
  const widthPx = Math.max(1, box.widthPx - box.margin.left - box.margin.right)
  const heightPx = Math.max(1, box.heightPx - top - bottom)
  return {
    top,
    right: box.margin.right,
    bottom,
    left: box.margin.left,
    widthPx,
    heightPx,
  }
}

export function sectionColumns(box: PageBox, sectXml: string): ColumnFrame[] {
  const frame = contentFrame(box)
  const attrs = xmlTagAttrs(sectXml, 'cols')
  const num = Math.max(1, Math.round(xmlNumber(attrs, 'num') ?? 1))
  const space = Math.round(twipToPx(xmlNumber(attrs, 'space') ?? 720))
  const explicit = [...sectXml.matchAll(/<w:col\b([^>]*)\/?>/gi)].map(
    (match) => ({
      widthPx: Math.max(1, Math.round(twipToPx(xmlNumber(match[1], 'w') ?? 0))),
      spacePx: Math.round(twipToPx(xmlNumber(match[1], 'space') ?? 0)),
    }),
  )
  if (explicit.length === num && explicit.every((col) => col.widthPx > 1)) {
    let left = 0
    return explicit.map((col, index) => {
      const frameCol = { left, widthPx: col.widthPx }
      left += col.widthPx + (index < num - 1 ? col.spacePx || space : 0)
      return frameCol
    })
  }
  if (num === 1) return [{ left: 0, widthPx: frame.widthPx }]
  const gap = space * (num - 1)
  const width = Math.max(1, Math.floor((frame.widthPx - gap) / num))
  return Array.from({ length: num }, (_, index) => ({
    left: index * (width + space),
    widthPx:
      index === num - 1
        ? Math.max(1, frame.widthPx - index * (width + space))
        : width,
  }))
}

export function documentPageBox(model: DocumentModelWire): PageBox {
  return pageBoxForSection(documentSectionXml(model))
}

/** The page box one `w:sectPr` fragment describes, with Word's defaults. */
export function pageBoxForSection(sect: string): PageBox {
  const size = xmlTagAttrs(sect, 'pgSz')
  const margin = xmlTagAttrs(sect, 'pgMar')
  return {
    widthPx: pxOr(xmlNumber(size, 'w'), A4_WIDTH_PX),
    heightPx: pxOr(xmlNumber(size, 'h'), A4_HEIGHT_PX),
    margin: {
      top: pxOr(xmlNumber(margin, 'top'), DEFAULT_MARGIN_PX),
      right: pxOr(xmlNumber(margin, 'right'), DEFAULT_MARGIN_PX),
      bottom: pxOr(xmlNumber(margin, 'bottom'), DEFAULT_MARGIN_PX),
      left: pxOr(xmlNumber(margin, 'left'), DEFAULT_MARGIN_PX),
    },
    headerPx: pxOr(xmlNumber(margin, 'header'), DEFAULT_HEADER_PX),
    footerPx: pxOr(xmlNumber(margin, 'footer'), DEFAULT_HEADER_PX),
  }
}

export function marginStories(
  model: DocumentModelWire,
  kind: 'header' | 'footer',
): DocumentStoryWire[] {
  const all = model.stories.filter((story) => story.kind === kind)
  const ids = sectionReferenceIds(model, kind)
  if (ids.length === 0) return all.slice(0, 1)
  const parts = new Set(
    ids.flatMap((id) => {
      const relationship = model.relationships.find(
        (item) => item.sourcePartName === 'word/document.xml' && item.id === id,
      )
      if (!relationship) return []
      try {
        const target = resolveRelationshipTarget(relationship)
        return target ? [target] : []
      } catch {
        return []
      }
    }),
  )
  const matched = all.filter((story) => parts.has(story.partName))
  return matched.length > 0 ? matched : all.slice(0, 1)
}

/**
 * The story the workspace edits when `kind` is open: the document story for
 * the body, the header/footer story the body's final section references —
 * the same story the margin band paints — or the single footnotes part,
 * whose note bodies paint beneath the body flow. A multi-section document's
 * other header/footer parts are preserved in the package but neither painted
 * nor editable.
 */
export function editingStoryFor(
  model: DocumentModelWire,
  kind: 'document' | 'header' | 'footer' | 'footnotes',
): DocumentStoryWire | undefined {
  if (kind === 'document') {
    return model.stories.find((story) => story.kind === 'document')
  }
  if (kind === 'footnotes') {
    return model.stories.find((story) => story.kind === 'footnotes')
  }
  return marginStories(model, kind)[0]
}

export function documentSectionXml(model: DocumentModelWire): string {
  const sections = documentSections(model)
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const xml = sections[index]?.xml
    if (xml) return xml
  }
  return ''
}

/** One section in body order: the paragraph it ends at, and its `w:sectPr`. */
export type DocumentSection = {
  /** The paragraph whose `w:pPr` carries this section's `w:sectPr`, or null
   * for the final body-level section. */
  endParagraphId: string | null
  xml: string
}

export function sectionXmlInFragment(fragment: string): string {
  return activeSectionXml(fragment)
}

/**
 * Every section in body order. A paragraph-level `w:sectPr` defines the
 * section that ends at that paragraph; the body-level `w:sectPr` (always the
 * last entry) governs the final section. E5 reads each section's geometry so a
 * section break starts a new page with that section's page setup.
 */
export function documentSections(model: DocumentModelWire): DocumentSection[] {
  const story = model.stories.find((item) => item.kind === 'document')
  const sections: DocumentSection[] = []
  for (const paragraph of story?.paragraphs ?? []) {
    for (const fragment of paragraph.preservedXmlFragments) {
      const xml = sectionXmlInFragment(fragment)
      if (xml) sections.push({ endParagraphId: paragraph.id, xml })
    }
  }
  const body = (story?.preservedXmlFragments ?? [])
    .map(sectionXmlInFragment)
    .find((xml) => xml.length > 0)
  sections.push({ endParagraphId: null, xml: body ?? '' })
  return sections
}

function sectionReferenceIds(
  model: DocumentModelWire,
  kind: 'header' | 'footer',
): string[] {
  const sect = documentSectionXml(model)
  const tag = kind === 'header' ? 'headerReference' : 'footerReference'
  const refs = [...sect.matchAll(new RegExp(`<w:${tag}\\b([^>]*)\\/?>`, 'gi'))]
  const ofType = (type: string) =>
    refs
      .map((match) => ({
        type: xmlAttr(match[1], 'type')?.toLowerCase() ?? 'default',
        id: xmlAttr(match[1], 'id'),
      }))
      .filter((item) => item.type === type && item.id)
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id))
  const first = /<w:titlePg\b/.test(sect) ? ofType('first') : []
  return first.length > 0 ? first : ofType('default')
}

function pxOr(twips: number | undefined, fallback: number): number {
  if (twips === undefined) return fallback
  return Math.max(0, Math.round(twipToPx(twips)))
}
