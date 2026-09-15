import type { FindingTarget } from './verification-mapping'

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

/** Every rendered fragment of a paragraph, in page order. */
function fragmentsFor(root: ParentNode, paragraphId: string): HTMLElement[] {
  // Filtered in JS rather than by selector: a paragraph id is model data and
  // needs no escaping rule, and a miss must be a miss rather than a selector
  // error.
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-paragraph-id]'),
  ).filter((element) => element.dataset.paragraphId === paragraphId)
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
 * The rendered range for a mapped finding, or null when the text is not
 * rendered here. A paragraph split across pages keeps its id on every fragment;
 * the range is anchored in the fragment that holds its start and clamped to
 * that fragment's end.
 */
export function rangeForTarget(root: ParentNode, target: FindingTarget) {
  if (target.kind !== 'mapped') return null
  const fragments = fragmentsFor(root, target.paragraphId)
  if (fragments.length === 0) return null
  const fragment =
    fragments.find((item) => {
      const { from, to } = fragmentBounds(item)
      return target.start >= from && target.start < to
    }) ?? fragments[fragments.length - 1]!
  const { to } = fragmentBounds(fragment)
  const end = Math.min(target.end, to)
  const startPoint = pointInFragment(fragment, target.start)
  const endPoint = pointInFragment(fragment, end)
  if (!startPoint || !endPoint) return null
  const range = document.createRange()
  try {
    range.setStart(startPoint.node, startPoint.offset)
    range.setEnd(endPoint.node, endPoint.offset)
  } catch {
    return null
  }
  return range
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
