import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { resolveRelationshipTarget } from '@obiter/ooxml'
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

export function contentFrame(box: PageBox): ContentFrame {
  const widthPx = Math.max(1, box.widthPx - box.margin.left - box.margin.right)
  const heightPx = Math.max(
    1,
    box.heightPx - box.margin.top - box.margin.bottom,
  )
  return {
    top: box.margin.top,
    right: box.margin.right,
    bottom: box.margin.bottom,
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
  const sect = documentSectionXml(model)
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

export function documentSectionXml(model: DocumentModelWire): string {
  const story = model.stories.find((item) => item.kind === 'document')
  const xml = [
    ...(story?.preservedXmlFragments ?? []),
    ...(story?.paragraphs.flatMap(
      (paragraph) => paragraph.preservedXmlFragments,
    ) ?? []),
  ].join('')
  return (
    xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/i)?.[0] ??
    xml.match(/<w:sectPr\b[^>]*\/>/i)?.[0] ??
    ''
  )
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
