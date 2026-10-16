import type { DocumentModelWire } from '@obiter/contracts'

import { editableParagraph } from './document-model-text'
import type { LaidOutPage } from './document-page-engine'
import type { ColumnFrame, ContentFrame, PageBox } from './document-page-layout'
import { paragraphListIndent } from './document-page-lists'
import { paragraphFace, type ParagraphFace } from './document-page-style'

/** Pixels per centimetre at the renderer's 96 CSS px per inch. */
export const RULER_CM_PX = 96 / 2.54

/**
 * The page geometry the ruler measures: the section's sheet, the content
 * frame inside its margins, and the column the measured paragraph flows in.
 */
export type RulerGeometry = {
  box: PageBox
  frame: ContentFrame
  column: ColumnFrame
}

/**
 * The indent markers, in pixels from the column's left edge. A list
 * paragraph's markers come from the numbering level — its text sits at
 * `leftPx` and its marker hangs at `leftPx - hangingPx` — while a plain
 * paragraph's come from the pPr `w:ind` values the face resolved, matching
 * the padding and text-indent the block paints.
 */
export type RulerMarkers = {
  /** Left edge of the paragraph's text block. */
  leftPx: number
  /** First-line edge: the hanging marker for a list or hanging indent. */
  firstLinePx: number
  /** Right edge of the paragraph's text block. */
  rightPx: number
}

export function rulerMarkers(input: {
  face?: ParagraphFace
  list?: { leftPx: number; hangingPx: number }
  columnWidthPx: number
}): RulerMarkers {
  const { face, list, columnWidthPx } = input
  const textIndent = face?.indentFirstPx ?? -(face?.indentHangingPx ?? 0)
  const leftPx = list?.leftPx ?? face?.indentLeftPx ?? 0
  return {
    leftPx,
    firstLinePx: list ? list.leftPx - list.hangingPx : leftPx + textIndent,
    rightPx: Math.max(0, columnWidthPx - (face?.indentRightPx ?? 0)),
  }
}

/**
 * A tick on the ruler: half-centimetre marks, labelled in centimetres at each
 * whole mark so the strip reads the same measure Word shows.
 */
export type RulerTick = {
  positionPx: number
  label?: string
}

export function rulerTicks(widthPx: number): RulerTick[] {
  const ticks: RulerTick[] = []
  const half = RULER_CM_PX / 2
  const count = Math.floor(widthPx / half)
  for (let index = 0; index <= count; index += 1) {
    const positionPx = index * half
    ticks.push({
      positionPx,
      ...(index % 2 === 0 ? { label: String(index / 2) } : {}),
    })
  }
  return ticks
}

function centimetres(px: number): string {
  return (px / RULER_CM_PX).toFixed(1)
}

/**
 * What the ruler strip paints: the page geometry plus the caret paragraph's
 * resolved face and list indent.
 */
export type RulerContext = {
  geometry: RulerGeometry
  face?: ParagraphFace
  list?: { leftPx: number; hangingPx: number }
}

/**
 * The page holding the caret supplies the measure — its own section box,
 * frame and column — and the caret paragraph's resolved indents become the
 * markers. A caret outside the body (a margin story, a painted note) owns no
 * column block, so the ruler falls back to the first page's frame and claims
 * no paragraph indents rather than guessing them.
 */
export function rulerContextFor(input: {
  pages: readonly LaidOutPage[]
  /** The painted model: stored runs plus folded drafts. */
  painted?: DocumentModelWire
  paragraphId: string | null
}): RulerContext | undefined {
  const { pages, painted, paragraphId } = input
  let laid: LaidOutPage | undefined
  let columnIndex = 0
  let owned = false
  if (paragraphId) {
    for (const candidate of pages) {
      const block = candidate.blocks.find((item) =>
        item.type === 'paragraph'
          ? item.paragraph.id === paragraphId
          : item.table.paragraphIds.includes(paragraphId),
      )
      if (block) {
        laid = candidate
        columnIndex = block.column ?? 0
        owned = true
        break
      }
    }
  }
  const page = laid ?? pages[0]
  const column = page?.columns[columnIndex] ?? page?.columns[0]
  if (!page || !column) return undefined
  const paragraph =
    owned && painted && paragraphId
      ? editableParagraph(painted, paragraphId)
      : undefined
  return {
    geometry: { box: page.box, frame: page.frame, column },
    face:
      paragraph && painted
        ? paragraphFace(paragraph, painted.styles)
        : undefined,
    list:
      paragraph && painted
        ? paragraphListIndent(paragraph, painted)
        : undefined,
  }
}

/** The ruler's spoken summary: real measurements, never placeholder values. */
export function rulerLabel(input: {
  geometry: RulerGeometry
  markers: RulerMarkers
}): string {
  const { geometry, markers } = input
  const columnLeft = geometry.frame.left + geometry.column.left
  return [
    `Ruler. Page width ${centimetres(geometry.box.widthPx)} cm.`,
    `Text column starts ${centimetres(columnLeft)} cm from the left edge and is ${centimetres(geometry.column.widthPx)} cm wide.`,
    `Left indent ${centimetres(markers.leftPx)} cm into the column,`,
    `first line ${centimetres(markers.firstLinePx)} cm,`,
    `right indent ${centimetres(markers.rightPx)} cm.`,
  ].join(' ')
}
