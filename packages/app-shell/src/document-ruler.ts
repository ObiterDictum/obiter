import type { DocumentModelWire } from '@obiter/contracts'

import { editableParagraph } from './document-model-text'
import type { LaidOutPage } from './document-page-engine'
import type { ColumnFrame, ContentFrame, PageBox } from './document-page-layout'
import { paragraphListIndent } from './document-page-lists'
import {
  paragraphFace,
  paragraphTextIndentPx,
  type ParagraphFace,
} from './document-page-style'

export const RULER_CM_PX = 96 / 2.54

export type RulerGeometry = {
  box: PageBox
  frame: ContentFrame
  column: ColumnFrame
}

export type RulerMarkers = {
  leftPx: number
  firstLinePx: number
  rightPx: number
}

export function rulerMarkers(input: {
  face?: ParagraphFace
  list?: { leftPx: number; hangingPx: number }
  columnWidthPx: number
}): RulerMarkers {
  const { face, list, columnWidthPx } = input
  const textIndent = face ? paragraphTextIndentPx(face) : 0
  const leftPx = list?.leftPx ?? face?.indentLeftPx ?? 0
  return {
    leftPx,
    firstLinePx: list ? list.leftPx - list.hangingPx : leftPx + textIndent,
    rightPx: Math.max(0, columnWidthPx - (face?.indentRightPx ?? 0)),
  }
}

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

export type RulerContext = {
  geometry: RulerGeometry
  face?: ParagraphFace
  list?: { leftPx: number; hangingPx: number }
}

export function rulerContextFor(input: {
  pages: readonly LaidOutPage[]
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
