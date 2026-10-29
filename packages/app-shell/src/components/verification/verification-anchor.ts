import type { FindingTarget, UnmappedReason } from './verification-mapping'
import { editableRangeText } from '../document-workspace/inline-change-review'

export const minimumFloatingViewportPx = 768

export function panelPlacement(viewportWidth: number): 'floating' | 'drawer' {
  return viewportWidth >= minimumFloatingViewportPx ? 'floating' : 'drawer'
}

type TextPoint = { node: Text; offset: number }

function isDecoration(node: Node): boolean {
  const parent = node.parentElement
  if (!parent) return true
  return (
    parent.closest('[data-inline-change]:not([data-inline-editable])') !==
      null ||
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
    if (node instanceof Text) nodes.push(node)
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

function fragmentsFor(
  root: ParentNode,
  target: Extract<FindingTarget, { kind: 'mapped' }>,
): HTMLElement[] {
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

export function renderedRangeMismatchReason(
  excerpt: string,
  spansFragments: boolean,
): RenderedRangeReason {
  if (excerpt.includes('\n') || excerpt.includes('\r'))
    return 'range_spans_line_break'
  if (spansFragments) return 'range_split_across_fragments'
  return 'text_changed_since_check'
}

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
  if (editableRangeText(result.range) === excerpt) {
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
