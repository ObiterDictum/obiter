import type { PendingRedlines } from './document-pending-redlines'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { ExtraRuns } from './document-word-edits'
import { documentStory } from './document-model-text'
import { takeFragment } from './document-page-flow'
import { widowMaxY } from './document-page-keep'
import {
  resolveFloat,
  type PageFloat,
  type PageTextBox,
} from './document-page-floats'
import type { ColumnFrame, ContentFrame, PageBox } from './document-page-layout'
import { drawingSolidFill } from './document-page-media'
import {
  paragraphLineCount,
  paragraphMeasure,
  paragraphMetrics,
  type ParagraphAnchor,
} from './document-page-measure'
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
  const measure = paragraphMeasure(
    item.paragraph,
    model,
    drafts,
    extraRuns,
    pendingRedlines,
  )
  const paragraph = measure.paragraph
  const projection = measure.projection
  const text = measure.text
  const breaks = [
    ...new Set(
      [...pageBreaks, ...measure.pageBreaks].map((at) =>
        projection.toDisplay(at),
      ),
    ),
  ].sort((left, right) => left - right)
  const face = measure.face
  const linePx = measure.linePx
  const fontSize = measure.fontSize
  const indent = measure.indent
  const textIndentPx = measure.textIndentPx
  const imagePx = measure.imagePx
  let placed = false
  let offset = 0
  let continuation = false
  let complete = false

  const place = () => {
    if (placed) return
    placeAnchors(measure.anchors, box, frame, column(), session)
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
    const widthPx = Math.max(1, column().widthPx - indent)
    const fragment = takeFragment({
      text: nextBreak === undefined ? text : text.slice(0, nextBreak),
      offset,
      startY,
      maxY: widowMaxY(
        face.widowControl !== false,
        (at) =>
          paragraphLineCount(measure, widthPx, at, at === 0 ? textIndentPx : 0),
        offset,
        startY,
        frame.heightPx,
        linePx,
        session.y > 0 && !continuation,
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
  anchors: readonly ParagraphAnchor[],
  box: PageBox,
  frame: ContentFrame,
  column: ColumnFrame,
  session: PageSession,
): void {
  for (const anchor of anchors) {
    const spec = anchor.spec
    const placed = resolveFloat(spec, box, frame, column, session.y)
    if (spec.isTextBox) {
      session.page.textBoxes.push({
        ...placed,
        paragraphIds: spec.textBoxParaIds,
        fill: drawingSolidFill(anchor.xml),
      })
    } else {
      session.page.floats.push(placed)
    }
  }
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
