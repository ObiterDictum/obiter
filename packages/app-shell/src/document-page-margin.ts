import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import {
  marginStories,
  documentPageBox,
  type PageBox,
} from './document-page-layout'
import { paragraphPlainText } from './document-model-text'
import { drawingAnchor, drawingScene } from './document-page-drawings'
import {
  drawingBoxSize,
  drawingHasPicture,
  drawingShapeFill,
  paragraphImageXml,
} from './document-page-media'
import { twipToPx, xmlNumber } from './document-page-units'
import {
  storyBlocks,
  tablePaintHeight,
  type DisplayTable,
} from './document-page-tables'

export type HeaderLetterhead = {
  pictures: string[]
  leftFill: string
  rightFill: string
  heightPx: number
}

export type TabStop = {
  val: 'left' | 'center' | 'right'
  posPx: number
}

const LETTERHEAD_GREY = '#A6A6A6'

export type FooterLetterhead = {
  fill: string
  heightPx: number
  page: string
  rows: Array<{ left: string; right: string }>
}

export function headerLetterhead(
  story: DocumentStoryWire,
  tables: DisplayTable[],
): HeaderLetterhead | undefined {
  if (story.kind !== 'header') return undefined
  if (tables.some(tableIsLetterheadBar)) return undefined

  const xmls = story.paragraphs.flatMap(paragraphImageXml)
  if (
    xmls.some(
      (xml) =>
        drawingScene(xml).parts.filter((part) => part.kind === 'rect').length >=
        2,
    )
  ) {
    return undefined
  }
  const pictures = xmls.filter(drawingHasPicture)
  const shapes = xmls.filter(
    (xml) => drawingShapeFill(xml) && !drawingHasPicture(xml),
  )
  const hasText = story.paragraphs.some((paragraph) =>
    paragraphPlainText(paragraph).trim(),
  )
  if (pictures.length === 0) return undefined
  if (shapes.length < 2 && hasText) return undefined
  const left = drawingShapeFill(shapes[0] ?? '') ?? LETTERHEAD_GREY
  const right =
    drawingShapeFill(shapes[shapes.length - 1] ?? '') ?? LETTERHEAD_GREY
  const bars = shapes.length > 0 ? shapes : pictures
  const heightPx = Math.max(
    40,
    ...bars.map((xml) => drawingBoxSize(xml).height),
  )
  return { pictures, leftFill: left, rightFill: right, heightPx }
}

export function footerLetterhead(
  story: DocumentStoryWire,
  pageNumber = 1,
): FooterLetterhead | undefined {
  if (story.kind !== 'footer') return undefined
  const xmls = story.paragraphs.flatMap(paragraphImageXml)
  const rect = xmls
    .flatMap((xml) => drawingScene(xml).parts)
    .find((part) => part.kind === 'rect' && part.fill)
  const fromBox = xmls.flatMap(textboxColumns)
  const fromParas = story.paragraphs
    .map((paragraph) =>
      paddedColumns(paragraphPlainText(paragraph), Boolean(rect)),
    )
    .filter((row): row is { left: string; right: string } => Boolean(row))
  const rows = uniqueFooterRows(fromBox.length > 0 ? fromBox : fromParas)
  if (!rect && rows.length === 0) return undefined
  return {
    fill: rect?.fill ?? '#212934',
    heightPx: Math.max(rect?.heightPx ?? 0, 72),
    page: String(pageNumber),
    rows,
  }
}

export function marginBandHeights(model: DocumentModelWire): {
  headerPx: number
  footerPx: number
} {
  const box = documentPageBox(model)
  let headerPx = 0
  let footerPx = 0
  for (const story of marginStories(model, 'header')) {
    headerPx = Math.max(headerPx, storyBandHeight(story, box))
  }
  for (const story of marginStories(model, 'footer')) {
    footerPx = Math.max(footerPx, storyBandHeight(story, box))
  }
  return { headerPx, footerPx }
}

function storyBandHeight(story: DocumentStoryWire, box: PageBox): number {
  const tables = storyBlocks(story)
    .filter((block) => block.type === 'table')
    .map((block) => block.table)
  const edgePx = story.kind === 'header' ? box.headerPx : 0
  return Math.max(
    0,
    headerLetterhead(story, tables)?.heightPx ?? 0,
    footerLetterhead(story)?.heightPx ?? 0,
    ...tables.map(tablePaintHeight),
    ...story.paragraphs.flatMap(paragraphImageXml).map((xml) => {
      const anchor = drawingAnchor(xml)
      const top = anchor?.topPx ?? 0
      const origin =
        !anchor ||
        anchor.relativeFromV === 'paragraph' ||
        anchor.relativeFromV === 'line'
          ? edgePx
          : anchor.relativeFromV === 'margin'
            ? story.kind === 'header'
              ? box.margin.top
              : 0
            : 0
      return Math.max(0, origin + top + drawingScene(xml).heightPx)
    }),
  )
}

function textboxColumns(xml: string): Array<{ left: string; right: string }> {
  const choiceOnly = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/gi, '')
  return [...choiceOnly.matchAll(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/gi)]
    .flatMap((block) =>
      [...block[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map((match) =>
        paddedColumns(
          [...match[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/gi)]
            .map((item) => xmlDecode(item[1] ?? ''))
            .join(''),
          false,
        ),
      ),
    )
    .filter((row): row is { left: string; right: string } => Boolean(row))
}

function uniqueFooterRows(
  rows: Array<{ left: string; right: string }>,
): Array<{ left: string; right: string }> {
  const compact = rows.filter((row) => row.left.length + row.right.length < 200)
  const source = compact.length > 0 ? compact : rows
  const seenLeft = new Set<string>()
  const seenRight = new Set<string>()
  const unique: Array<{ left: string; right: string }> = []
  for (const row of source) {
    const left = row.left.toLowerCase()
    const right = row.right.toLowerCase()
    if (left && seenLeft.has(left)) continue
    if (right && seenRight.has(right)) continue
    if (left) seenLeft.add(left)
    if (right) seenRight.add(right)
    unique.push(row)
  }
  return unique
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function paddedColumns(
  text: string,
  allowSingle: boolean,
): { left: string; right: string } | undefined {
  const value = text.replace(/\u00a0/g, ' ')
  if (!value.trim() || /^\d+$/.test(value.trim())) return undefined
  const parts = value
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { left: parts[0], right: parts[parts.length - 1] }
  }
  if (!allowSingle || parts.length !== 1 || !parts[0]) return undefined
  const line = parts[0]
  if (/www\.|registration|vat/i.test(line)) return { left: '', right: line }
  return { left: line, right: '' }
}

export function footerBandFill(
  story: DocumentStoryWire,
  tables: DisplayTable[],
): string | undefined {
  if (story.kind !== 'footer') return undefined
  const tableFill = tables
    .flatMap((table) => table.rows.flatMap((row) => row.cells))
    .map((cell) => cell.fill)
    .find((fill) => fill)
  if (tableFill) return tableFill
  return story.paragraphs
    .flatMap((paragraph) =>
      paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    )
    .map(drawingShapeFill)
    .find((fill) => fill)
}

export function paragraphIsDrawingOnly(
  paragraph: DocumentParagraphWire,
): boolean {
  return (
    paragraphImageXml(paragraph).length > 0 &&
    !paragraphPlainText(paragraph).trim()
  )
}

export function paragraphIsShapeOnly(
  paragraph: DocumentParagraphWire,
): boolean {
  const xmls = paragraphImageXml(paragraph)
  return (
    xmls.length > 0 &&
    xmls.every((xml) => drawingShapeFill(xml) && !drawingHasPicture(xml)) &&
    !paragraphPlainText(paragraph).trim()
  )
}

export function paragraphTabStops(paragraph: DocumentParagraphWire): TabStop[] {
  const xml = paragraph.preservedXmlFragments.join('')
  return [...xml.matchAll(/<w:tab\b([^>]*)\/?>/gi)]
    .map((match) => {
      const pos = xmlNumber(match[1], 'pos')
      const val = match[1]?.match(/(?:w:)?val="([^"]+)"/i)?.[1]?.toLowerCase()
      if (pos === undefined) return undefined
      if (val === 'center')
        return { val: 'center' as const, posPx: Math.round(twipToPx(pos)) }
      if (val === 'right' || val === 'end') {
        return { val: 'right' as const, posPx: Math.round(twipToPx(pos)) }
      }
      if (val === 'left' || val === 'num' || val === undefined) {
        return { val: 'left' as const, posPx: Math.round(twipToPx(pos)) }
      }
      return undefined
    })
    .filter((stop): stop is TabStop => stop !== undefined)
}

function tableIsLetterheadBar(table: DisplayTable): boolean {
  const cells = table.rows[0]?.cells
  if (!cells || cells.length !== 3) return false
  return Boolean(cells[0]?.fill || cells[2]?.fill)
}
