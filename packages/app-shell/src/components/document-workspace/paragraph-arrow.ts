import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from '../../document-edits'
import { paragraphPlainText } from '../../document-model-text'
import { wrapLines, type WrappedLine } from '../../document-page-flow'
import { paragraphFace } from '../../document-page-style'

export type ArrowNeighbor = {
  id: string
  text: string
  lines: WrappedLine[]
}

/**
 * The visual column a run of plain ArrowUp/ArrowDown presses is trying to
 * hold. It lives above the paragraph textarea so the remount when the caret
 * crosses into another paragraph does not lose it. Any other interaction
 * clears it.
 */
export type VerticalCaretColumn = {
  column: number | null
  /** The one destination a vertical move may hand the column to on focus. */
  pending: VerticalCaretDelivery | null
}

/** The paragraph a vertical move is about to focus, and where in it. */
export type VerticalCaretDelivery = {
  paragraphId: string
  offset: number
}

export function createVerticalCaretColumn(): VerticalCaretColumn {
  return { column: null, pending: null }
}

/** Arm the one-shot delivery for the paragraph a vertical move will focus. */
export function armVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  delivery: VerticalCaretDelivery,
): void {
  if (!state) return
  state.pending = delivery
}

/**
 * Whether `delivery` is the exact transition the pending move armed. A
 * programmatic selection that lands elsewhere, or at another offset of the
 * same paragraph, is not the transition and must end the run.
 */
export function isVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  delivery: VerticalCaretDelivery,
): boolean {
  return (
    state?.pending?.paragraphId === delivery.paragraphId &&
    state.pending.offset === delivery.offset
  )
}

/**
 * Consume the pending delivery on focus. Returns true only for the intended
 * destination; any other paragraph clears the run. Either way the transition
 * is spent, so it cannot leak into a later movement.
 */
export function consumeVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  paragraphId: string,
): boolean {
  if (!state) return false
  const intended = state.pending?.paragraphId === paragraphId
  state.pending = null
  return intended
}

/** The visual (wrapped-line) column the caret sits at. */
export function visualColumn(lines: WrappedLine[], offset: number): number {
  const line = lines[lineIndex(lines, offset)]
  return line ? Math.max(0, offset - line.from) : offset
}

/**
 * Establish the run's column on the first press, then read it back. A short
 * destination line clamps the caret, never the retained column.
 */
export function retainVerticalColumn(
  state: VerticalCaretColumn | undefined,
  lines: WrappedLine[],
  offset: number,
): number {
  if (!state) return visualColumn(lines, offset)
  state.column ??= visualColumn(lines, offset)
  return state.column
}

export function clearVerticalColumn(
  state: VerticalCaretColumn | undefined,
): void {
  if (!state) return
  state.column = null
  state.pending = null
}

/** The offset above or below with the caret at the retained visual column. */
export function offsetVertically(input: {
  key: 'ArrowUp' | 'ArrowDown'
  offset: number
  lines: WrappedLine[]
  column: number
}): number | undefined {
  const index = lineIndex(input.lines, input.offset)
  const line = input.lines[input.key === 'ArrowUp' ? index - 1 : index + 1]
  return line ? offsetOnLine(line, input.column) : undefined
}

export function offsetAfterArrow(input: {
  key: string
  offset: number
  text: string
  lines: WrappedLine[]
  column: number
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
}): { paragraphId: string; offset: number } | undefined {
  const { key, offset, text, lines, column, previous, next } = input
  const index = lineIndex(lines, offset)
  if (key === 'ArrowLeft' && offset === 0 && previous) {
    return { paragraphId: previous.id, offset: previous.text.length }
  }
  if (key === 'ArrowRight' && offset >= text.length && next) {
    return { paragraphId: next.id, offset: 0 }
  }
  if (key === 'ArrowUp' && index <= 0 && previous) {
    return {
      paragraphId: previous.id,
      offset: offsetOnLine(previous.lines[previous.lines.length - 1], column),
    }
  }
  if (key === 'ArrowDown' && index >= lines.length - 1 && next) {
    return {
      paragraphId: next.id,
      offset: offsetOnLine(next.lines[0], column),
    }
  }
}

function lineIndex(lines: WrappedLine[], offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    const last = index === lines.length - 1
    if (offset < line.to || last) return index
  }
  return Math.max(0, lines.length - 1)
}

function offsetOnLine(line: WrappedLine | undefined, column: number): number {
  if (!line) return column
  return Math.min(line.from + column, line.to)
}

export function arrowNeighbors(
  ctx: {
    model: DocumentModelWire
    drafts?: Record<string, string>
    inserts: LocalInsert[]
    deletedParagraphIds: string[]
    paragraphs: DocumentParagraphWire[]
  },
  paragraphId: string,
  wrapWidthPx?: number,
): { previous?: ArrowNeighbor; next?: ArrowNeighbor } {
  const order = flowParagraphIds(
    ctx.model,
    ctx.inserts,
    ctx.deletedParagraphIds,
  )
  const index = order.indexOf(paragraphId)
  return {
    previous: arrowNeighbor(order[index - 1], ctx, wrapWidthPx),
    next: arrowNeighbor(order[index + 1], ctx, wrapWidthPx),
  }
}

function arrowNeighbor(
  id: string | undefined,
  ctx: {
    model: DocumentModelWire
    drafts?: Record<string, string>
    inserts: LocalInsert[]
    paragraphs: DocumentParagraphWire[]
  },
  wrapWidthPx?: number,
): ArrowNeighbor | undefined {
  if (!id) return undefined
  const insert = ctx.inserts.find((item) => item.clientId === id)
  const paragraph = ctx.paragraphs.find((item) => item.id === id)
  const text = insert
    ? insertPlainText(insert)
    : paragraph
      ? paragraphPlainText(paragraph, ctx.drafts)
      : ''
  const face = paragraph
    ? paragraphFace(paragraph, ctx.model.styles)
    : undefined
  const fontSizePx = face?.run.fontSizePx ?? 16
  const lines =
    wrapWidthPx && wrapWidthPx > 0
      ? wrapLines(text, fontSizePx, wrapWidthPx, face?.run.fontFamily)
      : [{ text, from: 0, to: text.length }]
  return { id, text, lines }
}
