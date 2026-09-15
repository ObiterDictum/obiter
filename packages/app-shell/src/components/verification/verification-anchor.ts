import type { FindingTarget, UnmappedReason } from './verification-mapping'

/**
 * DOM anchoring for verification findings.
 *
 * The offsets in a finding are UTF-16 offsets into the paragraph's concatenated
 * run text, and the rendered page does not put that text in one node: it splits
 * runs, wraps lines into separate elements, and paints non-text decoration
 * (note marks, empty-line placeholders) inside the same container. Locating a
 * range therefore walks the rendered text with the offsets the page renderer
 * already exposes, and refuses rather than guessing when they are absent.
 */

/** The narrowest viewport that can host the floating panel beside the page. */
export const minimumFloatingViewportPx = 768

/**
 * One documented responsive rule: a viewport wide enough to hold the page and
 * the panel side by side keeps the floating panel; anything narrower uses the
 * drawer, which is a bottom sheet rather than a panel that covers the text.
 */
export function panelPlacement(viewportWidth: number): 'floating' | 'drawer' {
  return viewportWidth >= minimumFloatingViewportPx ? 'floating' : 'drawer'
}

export type TextPoint = { node: Text; offset: number }

function isDecoration(node: Node): boolean {
  const parent = node.parentElement
  if (!parent) return true
  // Note marks and empty-line placeholders are painted text that is not part of
  // the paragraph's run text, so they must not consume a character offset.
  return (
    parent.closest('[data-note-mark]') !== null ||
    parent.closest('[data-empty-line]') !== null
  )
}

function textNodesIn(scope: Element): Text[] {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isDecoration(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

function locateIn(scope: Element, offset: number): TextPoint | null {
  const nodes = textNodesIn(scope)
  const last = nodes[nodes.length - 1]
  if (!last) return null
  let cursor = 0
  for (const node of nodes) {
    const end = cursor + node.data.length
    if (offset <= end) {
      return { node, offset: Math.max(0, offset - cursor) }
    }
    cursor = end
  }
  return { node: last, offset: last.data.length }
}

/**
 * The rendered line element that carries a character offset. The page renderer
 * publishes each line's own half-open range, so a wrapped paragraph resolves
 * without reconstructing line breaks from the DOM.
 */
function lineFor(fragment: Element, offset: number): HTMLElement | null {
  const lines = fragment.querySelectorAll<HTMLElement>('[data-line-from]')
  if (lines.length === 0) return null
  let found: HTMLElement | null = null
  for (const line of lines) {
    const from = Number(line.dataset.lineFrom)
    if (Number.isFinite(from) && from <= offset) found = line
  }
  return found ?? lines[0] ?? null
}

/** Every rendered fragment of the paragraph this target names, in page order.
 * The filter also matches the story the target names: paragraph ids are only
 * unique inside a story, so a same-id body paragraph must never satisfy a
 * footnote finding. */
function fragmentsFor(
  root: ParentNode,
  target: Extract<FindingTarget, { kind: 'mapped' }>,
): HTMLElement[] {
  // Filtered in JS rather than by selector: a paragraph id is model data and
  // needs no escaping rule, and a miss must be a miss rather than a selector
  // error.
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-paragraph-id]'),
  ).filter(
    (element) =>
      element.dataset.paragraphId === target.paragraphId &&
      element.dataset.paragraphStory === target.storyKind &&
      element.dataset.paragraphPart === target.storyPartName,
  )
}

function pointInFragment(
  fragment: HTMLElement,
  offset: number,
): TextPoint | null {
  const line = lineFor(fragment, offset)
  if (line) {
    const from = Number(line.dataset.lineFrom)
    return locateIn(line, offset - (Number.isFinite(from) ? from : 0))
  }
  const container = fragment.querySelector('[data-paragraph-text]') ?? fragment
  const from = Number(fragment.dataset.paragraphFrom ?? 0)
  return locateIn(container, offset - (Number.isFinite(from) ? from : 0))
}

function fragmentBounds(fragment: HTMLElement) {
  const from = Number(fragment.dataset.paragraphFrom ?? 0)
  const to = fragment.dataset.paragraphTo
  return {
    from: Number.isFinite(from) ? from : 0,
    to: to === undefined ? Number.POSITIVE_INFINITY : Number(to),
  }
}

/**
 * How a mapped finding's rendered range failed, or that it was built. These
 * are renderer limits, not statements about the document: a hard break is not
 * painted, and a range the renderer split across page fragments cannot always
 * be reassembled. Only `text_changed_since_check` means the text differs.
 */
export type RenderedRangeReason = Extract<
  UnmappedReason,
  | 'range_spans_line_break'
  | 'range_split_across_fragments'
  | 'rendered_anchor_unavailable'
  | 'text_changed_since_check'
>

export type RenderedRange =
  | { kind: 'attached'; range: Range; spansFragments: boolean }
  | { kind: 'unavailable'; reason: RenderedRangeReason }

function fragmentHolding(
  fragments: HTMLElement[],
  offset: number,
): HTMLElement | undefined {
  return fragments.find((fragment) => {
    const { from, to } = fragmentBounds(fragment)
    return offset >= from && offset < to
  })
}

/**
 * The full rendered range for a mapped finding, or a stated reason it cannot be
 * expressed. A paragraph split across pages keeps its id on every fragment; a
 * range that crosses a fragment boundary is built across the fragments in page
 * order rather than clamped to the first one, so a finding is never attached to
 * a shorter excerpt than the one checked. The caller compares the range text to
 * the excerpt; this function only decides whether the range exists.
 */
export function rangeForTarget(
  root: ParentNode,
  target: FindingTarget,
): RenderedRange | null {
  if (target.kind !== 'mapped') return null
  const fragments = fragmentsFor(root, target)
  if (fragments.length === 0) {
    return { kind: 'unavailable', reason: 'rendered_anchor_unavailable' }
  }
  const startFragment = fragmentHolding(fragments, target.start)
  if (!startFragment) {
    return { kind: 'unavailable', reason: 'rendered_anchor_unavailable' }
  }
  // The end is exclusive, so place it after the range's last character. If that
  // character is not rendered, the tail is not on the page either: refuse
  // rather than clamp the range to what is drawn.
  const endFragment = fragmentHolding(fragments, target.end - 1)
  if (!endFragment) {
    return { kind: 'unavailable', reason: 'range_split_across_fragments' }
  }
  const startPoint = pointInFragment(startFragment, target.start)
  const endPoint = pointInFragment(endFragment, target.end)
  if (!startPoint || !endPoint) {
    return {
      kind: 'unavailable',
      reason:
        startFragment === endFragment
          ? 'rendered_anchor_unavailable'
          : 'range_split_across_fragments',
    }
  }
  const range = document.createRange()
  try {
    range.setStart(startPoint.node, startPoint.offset)
    range.setEnd(endPoint.node, endPoint.offset)
  } catch {
    return {
      kind: 'unavailable',
      reason:
        startFragment === endFragment
          ? 'rendered_anchor_unavailable'
          : 'range_split_across_fragments',
    }
  }
  return {
    kind: 'attached',
    range,
    spansFragments: startFragment !== endFragment,
  }
}

/**
 * Why a built range does not carry a finding's excerpt. A hard break is a
 * renderer limit, not a change to the document, and a range the renderer split
 * across fragments is a limit too; only a genuine text difference is reported
 * as one.
 */
export function renderedRangeMismatchReason(
  excerpt: string,
  spansFragments: boolean,
): RenderedRangeReason {
  if (excerpt.includes('\n') || excerpt.includes('\r'))
    return 'range_spans_line_break'
  if (spansFragments) return 'range_split_across_fragments'
  return 'text_changed_since_check'
}

/**
 * The one decision the marker layer and its tests share: either the page
 * carries this finding's exact excerpt, or it does not and there is a stated
 * reason. The range is built across fragments first, so a finding is never
 * attached to a clamped, shorter excerpt.
 */
export function renderedRangeFor(
  root: ParentNode,
  target: FindingTarget,
  excerpt: string,
): RenderedRange {
  const result = rangeForTarget(root, target)
  if (!result) {
    return { kind: 'unavailable', reason: 'rendered_anchor_unavailable' }
  }
  if (result.kind === 'unavailable') return result
  if (result.range.toString() === excerpt) {
    return {
      kind: 'attached',
      range: result.range,
      spansFragments: result.spansFragments,
    }
  }
  return {
    kind: 'unavailable',
    reason: renderedRangeMismatchReason(excerpt, result.spansFragments),
  }
}

/** The geometry a marker needs, without depending on the DOMRect class. */
export type RangeRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

const degenerateRect: RangeRect = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
}

export function rectsOfRange(range: Range): RangeRect[] {
  // A layout-free environment (jsdom) has no range geometry. A degenerate box
  // is still a position, so the marker is rendered and reachable rather than
  // silently dropped.
  if (typeof range.getClientRects !== 'function') return [degenerateRect]
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  )
  if (rects.length > 0) return rects
  const box =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : degenerateRect
  return [{ ...degenerateRect, ...box }]
}
