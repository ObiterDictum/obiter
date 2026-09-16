import {
  offsetAfterArrow,
  offsetVertically,
  type ArrowNeighbor,
} from './components/document-workspace/paragraph-arrow'
import type { WrappedLine } from './document-page-flow'

/**
 * One end of a document selection: a paragraph identifier and a UTF-16 offset
 * into that paragraph's model text. Paragraph ids are model ids, never array
 * positions, so a selection survives a re-layout that reorders fragments.
 */
export type SelectionEndpoint = { paragraphId: string; offset: number }

/** The single selection state: a stable anchor plus the moving focus. */
export type DocumentSelection = {
  anchor: SelectionEndpoint
  focus: SelectionEndpoint
}

/**
 * The document order a selection is resolved against. `order` is the flow of
 * paragraph identifiers and `textOf` reads the text the editor renders for one
 * of them, so an endpoint can be clamped and a range turned into segments.
 */
export type SelectionOrder = {
  order: readonly string[]
  textOf: (paragraphId: string) => string
}

export type SelectionSegment = {
  paragraphId: string
  from: number
  to: number
}

export function selectionCollapsed(selection: DocumentSelection): boolean {
  return (
    selection.anchor.paragraphId === selection.focus.paragraphId &&
    selection.anchor.offset === selection.focus.offset
  )
}

function orderIndex(order: readonly string[], paragraphId: string): number {
  return order.indexOf(paragraphId)
}

/**
 * Document order as a total order over endpoints: paragraph flow first, then
 * the offset inside the paragraph. Two endpoints in the same paragraph compare
 * by offset, which is what makes a backwards selection distinguishable.
 */
export function compareEndpoints(
  order: readonly string[],
  a: SelectionEndpoint,
  b: SelectionEndpoint,
): number {
  const left = orderIndex(order, a.paragraphId)
  const right = orderIndex(order, b.paragraphId)
  if (left === -1 || right === -1) return 0
  if (left !== right) return left < right ? -1 : 1
  if (a.offset === b.offset) return 0
  return a.offset < b.offset ? -1 : 1
}

export function selectionDirection(
  order: readonly string[],
  selection: DocumentSelection,
): 'forward' | 'backward' | 'none' {
  const compared = compareEndpoints(order, selection.anchor, selection.focus)
  if (compared === 0) return 'none'
  return compared < 0 ? 'forward' : 'backward'
}

/** The earlier and later endpoint of a selection, in document order. */
export function orderedSelection(
  order: readonly string[],
  selection: DocumentSelection,
): { start: SelectionEndpoint; end: SelectionEndpoint } {
  return selectionDirection(order, selection) === 'backward'
    ? { start: selection.focus, end: selection.anchor }
    : { start: selection.anchor, end: selection.focus }
}

/**
 * The selected segment of every paragraph the selection touches. A paragraph
 * strictly between the two endpoints is selected whole, an empty one included:
 * its paragraph break is part of the selection even though it paints no text,
 * which the renderer shows as an empty selected row. A collapsed selection has
 * no segments.
 */
export function selectionSegments(
  context: SelectionOrder,
  selection: DocumentSelection,
): SelectionSegment[] {
  if (selectionCollapsed(selection)) return []
  const { start, end } = orderedSelection(context.order, selection)
  const from = orderIndex(context.order, start.paragraphId)
  const to = orderIndex(context.order, end.paragraphId)
  if (from === -1 || to === -1) return []
  if (from === to) {
    const offsetFrom = Math.min(start.offset, end.offset)
    const offsetTo = Math.max(start.offset, end.offset)
    return offsetFrom === offsetTo
      ? []
      : [
          {
            paragraphId: start.paragraphId,
            from: clampOffset(context, start.paragraphId, offsetFrom),
            to: clampOffset(context, start.paragraphId, offsetTo),
          },
        ]
  }
  const segments: SelectionSegment[] = []
  for (let index = from; index <= to; index += 1) {
    const paragraphId = context.order[index]
    if (paragraphId === undefined) continue
    const length = context.textOf(paragraphId).length
    const segmentFrom =
      index === from ? clampOffset(context, paragraphId, start.offset) : 0
    const segmentTo =
      index === to ? clampOffset(context, paragraphId, end.offset) : length
    segments.push({
      paragraphId,
      from: Math.min(segmentFrom, length),
      to: Math.min(Math.max(segmentTo, segmentFrom), length),
    })
  }
  return segments
}

/** The same segments keyed by paragraph, for a per-paragraph render decision. */
export function selectionSegmentMap(
  context: SelectionOrder,
  selection: DocumentSelection,
): Map<string, SelectionSegment> {
  return new Map(
    selectionSegments(context, selection).map((segment) => [
      segment.paragraphId,
      segment,
    ]),
  )
}

/**
 * Plain text for a clipboard write. A paragraph break inside the selection
 * copies as a newline, the way a word processor copies a multi-paragraph
 * range, and an empty intermediate paragraph therefore copies an empty line.
 */
export function selectionPlainText(
  context: SelectionOrder,
  selection: DocumentSelection,
): string {
  return selectionSegments(context, selection)
    .map((segment) =>
      context.textOf(segment.paragraphId).slice(segment.from, segment.to),
    )
    .join('\n')
}

/**
 * Re-resolve a selection against the current document. An endpoint whose
 * paragraph is gone (deleted, or a version switch that changed the paragraph
 * ids) drops the whole selection; an offset past the paragraph's text clamps,
 * because a document that shrank must not leave a focus beyond its own text.
 * Derived rather than stored, so an effect is never needed to reconcile.
 */
export function reconcileSelection(
  context: SelectionOrder,
  selection: DocumentSelection | null,
): DocumentSelection | null {
  if (!selection) return null
  const anchor = reconcileEndpoint(context, selection.anchor)
  const focus = reconcileEndpoint(context, selection.focus)
  if (!anchor || !focus) return null
  if (
    sameEndpoint(anchor, selection.anchor) &&
    sameEndpoint(focus, selection.focus)
  ) {
    return selection
  }
  return { anchor, focus }
}

/** A whole-document selection: offset 0 of the first paragraph to its end. */
export function wholeDocumentSelection(
  context: SelectionOrder,
): DocumentSelection | null {
  const first = context.order[0]
  const last = context.order[context.order.length - 1]
  if (first === undefined || last === undefined) return null
  return {
    anchor: { paragraphId: first, offset: 0 },
    focus: { paragraphId: last, offset: context.textOf(last).length },
  }
}

function reconcileEndpoint(
  context: SelectionOrder,
  endpoint: SelectionEndpoint,
): SelectionEndpoint | null {
  if (orderIndex(context.order, endpoint.paragraphId) === -1) return null
  return {
    paragraphId: endpoint.paragraphId,
    offset: clampOffset(context, endpoint.paragraphId, endpoint.offset),
  }
}

function clampOffset(
  context: SelectionOrder,
  paragraphId: string,
  offset: number,
): number {
  return Math.max(0, Math.min(offset, context.textOf(paragraphId).length))
}

function sameEndpoint(a: SelectionEndpoint, b: SelectionEndpoint): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset
}

/**
 * The endpoint one arrow press moves the focus to, in the same geometry the
 * caret suites establish: horizontal steps move one code point and cross a
 * paragraph edge, vertical steps follow the retained visual column through
 * wrapped lines and then cross into the neighbouring paragraph. Returns
 * undefined when the press cannot move, which is what keeps Shift+Arrow at the
 * document edge a no-op instead of a selection of nothing.
 *
 * Movement follows code points, not graphemes: a step enters or leaves a whole
 * surrogate pair so a focus can never land inside one, and the offsets stay in
 * the UTF-16 code units the rest of the document model uses. That matches the
 * code-unit offsets the repository's spans and edit operations are written in,
 * and it is what a native textarea does with an astral character.
 */
export function stepSelectionFocus(input: {
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  paragraphId: string
  offset: number
  text: string
  lines: WrappedLine[]
  column: number
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
}): SelectionEndpoint | undefined {
  const { key, paragraphId, offset, text, lines, column, previous, next } =
    input
  if (key === 'ArrowLeft') {
    if (offset > 0) {
      return { paragraphId, offset: stepCodePoint(text, offset, -1) }
    }
    return previous
      ? { paragraphId: previous.id, offset: previous.text.length }
      : undefined
  }
  if (key === 'ArrowRight') {
    if (offset < text.length) {
      return { paragraphId, offset: stepCodePoint(text, offset, 1) }
    }
    return next ? { paragraphId: next.id, offset: 0 } : undefined
  }
  const within = offsetVertically({ key, offset, lines, column })
  if (within != null) return { paragraphId, offset: within }
  return offsetAfterArrow({
    key,
    offset,
    text,
    lines,
    column,
    previous,
    next,
  })
}

/**
 * One horizontal step from `offset`, never landing inside a surrogate pair.
 * A low surrogate is stepped over when moving left and a high surrogate when
 * moving right, so the focus always sits on a code point boundary.
 */
function stepCodePoint(
  text: string,
  offset: number,
  direction: -1 | 1,
): number {
  if (direction < 0) {
    const previous = offset - 1
    return isLowSurrogate(text.charCodeAt(previous)) ? previous - 1 : previous
  }
  return isHighSurrogate(text.charCodeAt(offset)) ? offset + 2 : offset + 1
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
