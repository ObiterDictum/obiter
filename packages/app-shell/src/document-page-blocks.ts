import type { PendingRedlines } from './document-pending-redlines'
import { pendingParagraphChanges } from './document-pending-redlines'
import { paragraphPartName } from './document-inline-index'
import { inlineChanges } from './document-inline-changes'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { ExtraRuns } from './document-word-edits'
import { documentStory, effectiveParagraph } from './document-model-text'
import { firstLineIndentPx, takeFragment } from './document-page-flow'
import { drawingScene } from './document-page-drawings'
import { paragraphMetrics, widowMaxY } from './document-page-keep'
import {
  drawingFloat,
  paragraphAnchorXml,
  paragraphInlineXml,
  resolveFloat,
  type PageFloat,
  type PageTextBox,
} from './document-page-floats'
import type { ColumnFrame, ContentFrame, PageBox } from './document-page-layout'
import { drawingSolidFill } from './document-page-media'
import { paragraphListIndent } from './document-page-lists'
import { paragraphFace, paragraphLineHeightPx } from './document-page-style'
import {
  rowPaintHeight,
  type DisplayTable,
  type StoryBlock,
} from './document-page-tables'

export type LaidOutParagraph = {
  type: 'paragraph'
  paragraph: DocumentParagraphWire
  from?: number
  to?: number
  column?: number
  padLeftPx?: number
  padRightPx?: number
  wrapWidthPx?: number
  continuation?: boolean
  pageStart?: boolean
}

export type LaidOutTable = {
  type: 'table'
  table: DisplayTable
  column?: number
}

export type LaidOutBlock = LaidOutParagraph | LaidOutTable

export type LaidOutPage = {
  box: PageBox
  frame: ContentFrame
  columns: ColumnFrame[]
  blocks: LaidOutBlock[]
  floats: PageFloat[]
  textBoxes: PageTextBox[]
  contentPx?: number
}

export type PageSession = {
  page: LaidOutPage
  col: number
  y: number
  broken: boolean
  trailingBreak: boolean
}

export function layoutParagraph(
  item: Extract<StoryBlock, { type: 'paragraph' }>,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  hosts: Set<string>,
  box: PageBox,
  frame: ContentFrame,
  session: PageSession,
  column: () => ColumnFrame,
  advance: () => void,
  pageBreaks: readonly number[] = [],
  pendingRedlines?: PendingRedlines,
): void {
  const paragraph = effectiveParagraph(
    item.paragraph,
    drafts,
    extraRuns[item.paragraph.id] ?? [],
  )
  const partName = paragraphPartName(model, item.paragraph)
  const projection = inlineChanges(
    paragraph,
    model.changes,
    partName,
    pendingParagraphChanges(pendingRedlines, paragraph.id, partName),
  )
  const text = projection.text
  const breaks = [
    ...new Set(
      [...pageBreaks, ...storedPageBreakOffsets(paragraph)].map((at) =>
        projection.toDisplay(at),
      ),
    ),
  ].sort((left, right) => left - right)
  const face = paragraphFace(paragraph, model.styles)
  const linePx = paragraphLineHeightPx(face)
  const fontSize = face.run.fontSizePx ?? linePx
  const list = paragraphListIndent(paragraph, model)
  const indent =
    (list?.leftPx ?? face.indentLeftPx ?? 0) + (face.indentRightPx ?? 0)
  const textIndentPx = firstLineIndentPx(face, Boolean(list))
  const imagePx = Math.max(
    0,
    ...paragraphInlineXml(paragraph).map((xml) => drawingScene(xml).heightPx),
  )
  let placed = false
  let offset = 0
  let continuation = false
  let complete = false

  const place = () => {
    if (placed) return
    placeAnchors(paragraph, box, frame, column(), session)
    placed = true
  }

  if (breaks.includes(0) && session.y > 0) advance()

  if (imagePx > 0) {
    if (session.y > 0 && imagePx + linePx > frame.heightPx - session.y) {
      advance()
    }
    place()
    session.y += imagePx
    if (!text.trim()) return
  }

  if (hosts.has(paragraph.id) && !text.trim()) {
    place()
    return
  }

  while (!complete) {
    const nextBreak = breaks.find((at) => at > offset)
    const pageStart = session.y === 0 && session.broken && !continuation
    const before = continuation || pageStart ? 0 : (face.marginTopPx ?? 0)
    const remaining = frame.heightPx - session.y
    const needed =
      before + linePx + (text.length === 0 ? (face.marginBottomPx ?? 0) : 0)
    if (
      session.y > 0 &&
      (continuation ? needed > remaining : needed >= remaining)
    ) {
      advance()
      continue
    }
    place()
    const startY = session.y + before
    const fragment = takeFragment({
      text: nextBreak === undefined ? text : text.slice(0, nextBreak),
      offset,
      startY,
      maxY: widowMaxY(
        face.widowControl !== false,
        text,
        offset,
        startY,
        frame.heightPx,
        linePx,
        fontSize,
        Math.max(1, column().widthPx - indent),
        session.y > 0 && !continuation,
        face.run.fontFamily,
        textIndentPx,
      ),
      linePx,
      fontSize,
      fontFamily: face.run.fontFamily,
      textIndentPx,
      indent,
      column: column(),
      frame,
      floats: [...session.page.floats, ...session.page.textBoxes],
    })
    if (fragment.skipTo !== undefined && fragment.lines === 0) {
      session.y = fragment.skipTo
      if (session.y >= frame.heightPx) advance()
      continue
    }
    if (fragment.lines === 0 && text.length > 0) {
      if (session.y === 0) {
        if (offset >= text.length) break
        offset += 1
        continue
      }
      advance()
      continue
    }
    const used =
      fragment.heightPx + (fragment.complete ? (face.marginBottomPx ?? 0) : 0)
    if (
      session.y > 0 &&
      (continuation
        ? startY + used > frame.heightPx
        : startY + used >= frame.heightPx)
    ) {
      advance()
      placed = false
      continue
    }
    session.page.blocks.push({
      type: 'paragraph',
      paragraph,
      from: offset,
      to: offset + fragment.shown,
      column: session.col,
      padLeftPx: fragment.padLeftPx,
      padRightPx: fragment.padRightPx,
      wrapWidthPx: Math.max(
        1,
        column().widthPx - indent - fragment.padLeftPx - fragment.padRightPx,
      ),
      continuation,
      pageStart,
    })
    session.y = startY + used
    offset += fragment.consumed
    complete = fragment.complete
    continuation = true
    if (fragment.complete && nextBreak !== undefined) {
      complete = nextBreak >= text.length
      advance()
      placed = false
      continuation = false
      session.trailingBreak = complete
    }
  }
}

function placeAnchors(
  paragraph: DocumentParagraphWire,
  box: PageBox,
  frame: ContentFrame,
  column: ColumnFrame,
  session: PageSession,
): void {
  for (const xml of paragraphAnchorXml(paragraph)) {
    const spec = drawingFloat(xml, paragraph.id)
    if (!spec) continue
    const placed = resolveFloat(spec, box, frame, column, session.y)
    if (spec.isTextBox) {
      session.page.textBoxes.push({
        ...placed,
        paragraphIds: spec.textBoxParaIds,
        fill: drawingSolidFill(xml),
      })
    } else {
      session.page.floats.push(placed)
    }
  }
}

function storedPageBreakOffsets(paragraph: DocumentParagraphWire): number[] {
  const offsets: number[] = []
  const paragraphXml = paragraph.preservedXmlFragments.join('')
  if (pageBreakBefore(paragraphXml) || hasPageBreakElement(paragraphXml)) {
    offsets.push(0)
  }
  let cursor = 0
  for (const run of paragraph.runs) {
    if (hasPageBreakElement(run.preservedXmlFragments.join(''))) {
      offsets.push(cursor)
    }
    cursor += run.text.length
  }
  return offsets
}

function hasPageBreakElement(xml: string): boolean {
  return /<w:br\b[^>]*w:type="page"/i.test(xml)
}

function pageBreakBefore(xml: string): boolean {
  const before = xml.match(/<w:pageBreakBefore\b([^>]*)\/?>/i)
  if (!before) return false
  const val = before[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return val !== 'false' && val !== '0' && val !== 'off'
}

export function tableHeight(
  table: DisplayTable,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  widthPx: number,
  paragraphs: readonly DocumentParagraphWire[] = documentStory(model)
    ?.paragraphs ?? [],
  pendingRedlines?: PendingRedlines,
): number {
  const paras = new Map(
    paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  return table.rows.reduce((sum, row) => {
    const cellWidth = Math.max(1, widthPx / Math.max(1, row.cells.length))
    const content = Math.max(
      0,
      ...row.cells.map((cell) =>
        cell.paragraphIds.reduce((height, id) => {
          const paragraph = paras.get(id)
          if (!paragraph) return height
          return (
            height +
            paragraphMetrics(
              paragraph,
              model,
              drafts,
              extraRuns,
              cellWidth,
              pendingRedlines,
            ).heightPx
          )
        }, 0),
      ),
    )
    return sum + Math.max(rowPaintHeight(row), content)
  }, 0)
}

export function emptyPage(
  box: PageBox,
  frame: ContentFrame,
  columns: ColumnFrame[],
): LaidOutPage {
  return { box, frame, columns, blocks: [], floats: [], textBoxes: [] }
}
