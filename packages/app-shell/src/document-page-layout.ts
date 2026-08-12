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

const DEFAULT_MARGIN_PX = 96
const DEFAULT_HEADER_PX = 48

export function documentPageBox(model: DocumentModelWire): PageBox {
  const sect = sectionXml(model)
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

function sectionXml(model: DocumentModelWire): string {
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
  const sect = sectionXml(model)
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
