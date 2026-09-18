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
  /** A pending inserted paragraph: a neighbour for the caret, not for the
   * selection, which the workspace refuses to extend into. */
  insert?: boolean
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

/**
 * The visual line that owns `offset`, following the projection convention
 * `wrapLines` encodes: each line carries the display code units `[from, to)`
 * and the newline of a hard break is dropped between lines. That leaves two
 * boundary shapes, and ownership follows where the caret renders:
 *
 * - a soft wrap shares its boundary (`line.to === next.from`), so the offset
 *   is the next line's column 0;
 * - a hard break sits its newline at `line.to` and starts the next line at
 *   `line.to + 1`, so the newline slot belongs to the line it terminates and
 *   the caret stays at that line's visual end rather than skipping forward.
 *
 * The final line owns any offset at or past its end, which clamps a caret
 * pushed beyond the text and puts the empty row a trailing hard break opens at
 * `text.length` on the line that draws it.
 */
function lineIndex(lines: WrappedLine[], offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    const next = lines[index + 1]
    if (offset < line.to) return index
    if (offset === line.to && (!next || next.from > line.to)) return index
  }
  return Math.max(0, lines.length - 1)
}

/**
 * The offset a retained visual column resolves to on a line, clamped to the
 * line. Columns are counted in the same UTF-16 code units as the model and the
 * edit operations, so on a line holding an astral character a column can point
 * at the low half of a surrogate pair, where no caret can sit. Such a column
 * resolves to the pair's start: the pair is one glyph, the two boundaries are
 * equidistant, and rounding down (not up) is what keeps the desired column
 * (E34) and the line's ownership (E54/E56) without ever splitting the pair.
 */
function offsetOnLine(line: WrappedLine | undefined, column: number): number {
  if (!line) return column
  const candidate = Math.min(line.from + column, line.to)
  const local = candidate - line.from
  if (local < line.text.length && isLowSurrogate(line.text.charCodeAt(local))) {
    return Math.max(0, candidate - 1)
  }
  // A wrap that ends between a pair's halves leaves the line's `to` on the low
  // surrogate, so the offset the column resolves to belongs to the line's end
  // and is not a valid caret position. Step back onto the high surrogate.
  if (
    candidate === line.to &&
    isHighSurrogate(line.text.charCodeAt(line.text.length - 1))
  ) {
    return candidate - 1
  }
  return candidate
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export type ParagraphNeighborResolver = (
  paragraphId: string,
  wrapWidthPx?: number,
  /** The caller's current draft map, so a stable resolver still reads fresh
   * text without being rebuilt on every keystroke. */
  drafts?: Record<string, string>,
) => { previous?: ArrowNeighbor; next?: ArrowNeighbor }

/**
 * A resolver over the story's flow order. The order and its index are built
 * once, so resolving a paragraph's neighbours is a lookup rather than a walk
 * of the whole document. The previous shape called `flowParagraphIds` per
 * paragraph during rendering, which made a render O(n^2); this keeps that out
 * of the render path while the wrap and face work still happens only for the
 * paragraph that actually asks for a neighbour.
 */
export function paragraphNeighborResolver(ctx: {
  model: DocumentModelWire
  drafts?: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  paragraphs: DocumentParagraphWire[]
}): ParagraphNeighborResolver {
  const order = flowParagraphIds(
    ctx.model,
    ctx.inserts,
    ctx.deletedParagraphIds,
  )
  const index = new Map(order.map((id, at) => [id, at]))
  return (paragraphId, wrapWidthPx, drafts) => {
    const at = index.get(paragraphId)
    if (at === undefined) return {}
    const live = drafts ? { ...ctx, drafts } : ctx
    return {
      previous: arrowNeighbor(order[at - 1], live, wrapWidthPx),
      next: arrowNeighbor(order[at + 1], live, wrapWidthPx),
    }
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
  // Without a column width the projection still owns the break structure: a
  // row per hard-break segment, and the empty row a trailing break opens.
  const lines = wrapLines(
    text,
    fontSizePx,
    wrapWidthPx && wrapWidthPx > 0 ? wrapWidthPx : Number.POSITIVE_INFINITY,
    face?.run.fontFamily,
  )
  return { id, text, lines, ...(insert ? { insert: true } : {}) }
}
