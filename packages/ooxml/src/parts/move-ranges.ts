import type { XmlElementRange } from '../model'
import {
  attributeValue,
  elementRange,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'
import { isParagraphMarkMove, isTrackedChange } from './tracked-change-nodes'

// Move pairing per ISO/IEC 29500-1 §17.13.5: a tracked move is a named
// container — moveFromRangeStart/moveFromRangeEnd on the source side and
// moveToRangeStart/moveToRangeEnd on the destination side — whose shared
// w:name links the two groups. The w:moveFrom/w:moveTo wrappers inside carry
// their own distinct w:ids and no name. One name can hold several ranges and
// one range can wrap several runs, so a move is a group, not a pair of
// elements.
//
// A wrapper outside any container is tolerated legacy markup: some producers
// pair halves by a shared w:id, which the caller handles as a fallback — but
// only when deciding it cannot strand markup outside its own range. A paired
// range marker it covers while the mate lies outside, a move-range marker it
// carries, or an unformed marker span bracketing it would all leave orphaned
// range markup behind, so such a wrapper reports blocked instead.
// Containers that fail their shape rules — unmatched markers, missing names,
// content no member wrapper covers, paragraph-mark moves — stay listed and
// byte-preserved but undecidable rather than half-apply a move.

type MoveContainer = {
  side: 'from' | 'to'
  name: string
  start: XmlElement
  end: XmlElement
  clean: boolean
}

export type MoveMembership =
  | { kind: 'member'; key: string; markers: XmlElementRange[] }
  // A wrapper inside a container that failed its shape rules, or an
  // uncontainered wrapper whose decision would strand range markup.
  | { kind: 'blocked' }
  // A clean wrapper outside any container: the shared-w:id legacy fallback.
  | { kind: 'uncontainered' }

export type MoveRangeIndex = ReturnType<typeof resolveMoveRanges>

const MARKER_NAMES = {
  from: { start: 'moveFromRangeStart', end: 'moveFromRangeEnd' },
  to: { start: 'moveToRangeStart', end: 'moveToRangeEnd' },
} as const

// Point-in-range markup that comes in matched pairs: a start and an end that
// share a w:id within the part. A member wrapper that covers one half while
// the mate survives outside the container would strand an orphan, so such a
// container stays undecidable.
const PAIRED_RANGE_MARKERS = [
  ['bookmarkStart', 'bookmarkEnd'],
  ['commentRangeStart', 'commentRangeEnd'],
  ['permStart', 'permEnd'],
  ['customXmlInsRangeStart', 'customXmlInsRangeEnd'],
  ['customXmlDelRangeStart', 'customXmlDelRangeEnd'],
  ['customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd'],
  ['customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd'],
] as const
const RANGE_MARKER_NAMES = new Set<string>(PAIRED_RANGE_MARKERS.flat())
const MOVE_RANGE_MARKERS = new Set([
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
])

export function resolveMoveRanges(
  partName: string,
  elements: readonly XmlElement[],
) {
  // Each start marker pairs with the first unmatched end carrying its w:id in
  // document order; a start without one is ignored and no container exists.
  // Move names are scoped to the story part that holds them.
  const containers: MoveContainer[] = []
  for (const side of ['from', 'to'] as const) {
    const pending = new Map<string, { name: string; element: XmlElement }[]>()
    for (const element of elements) {
      if (isWord(element, MARKER_NAMES[side].start)) {
        const id = attributeValue(element, WORD_NAMESPACE, 'id')
        const name = attributeValue(element, WORD_NAMESPACE, 'name')
        if (id === undefined || !name) continue
        const queue = pending.get(id) ?? []
        queue.push({ name, element })
        pending.set(id, queue)
      } else if (isWord(element, MARKER_NAMES[side].end)) {
        const id = attributeValue(element, WORD_NAMESPACE, 'id')
        const start = id === undefined ? undefined : pending.get(id)?.shift()
        if (start) {
          containers.push({
            side,
            name: start.name,
            start: start.element,
            end: element,
            clean: true,
          })
        }
      }
    }
  }

  // Pair the non-move range markers by w:id so the clean check can tell a
  // wrapped marker whose mate also sits inside the container from one whose
  // mate would be stranded outside by the decision.
  const markerMates = pairRangeMarkers(elements)

  // A container is decidable only when everything it carries is content a
  // member wrapper owns: every tracked-change element, run or paragraph fully
  // inside it must sit inside a same-side moveFrom/moveTo wrapper. A bare run
  // or a paragraph-mark move (the block-move shape) or a foreign change in
  // the range would survive a member-wise decision stranded, so the whole
  // group stays undecidable instead.
  // Elements are in document order, so everything a container can carry is the
  // run between its two markers. Asking that of the whole part once per
  // container made a document with many moves quadratic in its size.
  const firstAtOrAfter = (offset: number) => {
    let low = 0
    let high = elements.length
    while (low < high) {
      const middle = (low + high) >> 1
      const element = elements[middle]
      if (element !== undefined && element.start < offset) low = middle + 1
      else high = middle
    }
    return low
  }

  function cleanContainer(container: MoveContainer) {
    const memberName = container.side === 'from' ? 'moveFrom' : 'moveTo'
    const inside = (element: XmlElement) =>
      element.start >= container.start.end && element.end <= container.end.start
    for (
      let index = firstAtOrAfter(container.start.end);
      index < elements.length;
      index += 1
    ) {
      const element = elements[index]
      if (element === undefined || element.start > container.end.start) break
      if (!inside(element)) continue
      // A nested move container is never safe to decide: its markers belong
      // to a different named group, but the member-wise decision of this
      // group would still rewrite the range they sit in. Fail closed rather
      // than decide another group's members unnamed.
      if (MOVE_RANGE_MARKERS.has(element.localName)) return false
      const isRangeMarker = RANGE_MARKER_NAMES.has(element.localName)
      // Paired range markers are container-bearing too: one half inside the
      // range with its mate outside would strand markup the decision leaves
      // behind, so the container stays undecidable. proofErr is a lone point
      // hint, not a range, and Word scatters it freely, so it is allowed
      // through.
      if (
        !isTrackedChange(element) &&
        !isWord(element, 'r') &&
        !isWord(element, 'p') &&
        !isRangeMarker
      ) {
        continue
      }
      let covered = false
      let current: XmlElement | undefined = element
      while (current) {
        if (isTrackedChange(current)) {
          covered = isWord(current, memberName) && !isParagraphMarkMove(current)
          break
        }
        current = current.parent
      }
      if (!covered) return false
      // The decision deletes or carries the whole covered range, so a paired
      // marker whose mate lies outside the container would strand the mate.
      if (isRangeMarker) {
        const mate = markerMates.get(element)
        if (mate && !inside(mate)) return false
      }
    }
    return true
  }
  for (const container of containers)
    container.clean = cleanContainer(container)

  const blockedNames = new Set(
    containers.filter((container) => !container.clean).map(({ name }) => name),
  )
  const markerRanges = new Map<string, XmlElementRange[]>()
  const formedMarkers = new Set<XmlElement>()
  for (const container of containers) {
    formedMarkers.add(container.start)
    formedMarkers.add(container.end)
    const ranges = markerRanges.get(container.name) ?? []
    ranges.push(elementRange(container.start), elementRange(container.end))
    markerRanges.set(container.name, ranges)
  }

  // The tolerated shared-w:id fallback applies the container rule with the
  // wrapper itself as the boundary: a decision rewrites exactly that range,
  // so a paired marker it covers while the mate survives outside, a
  // move-range marker it carries, or unformed marker markup bracketing it —
  // a same-side start before and end after that no container claimed —
  // would strand markup. Those wrappers stay undecidable instead of pairing.
  // The bracketing question only needs the extremes: an unformed start before
  // the wrapper at all is one whose end is the earliest of them, and an unformed
  // end after it is one whose start is the latest. Reading those once keeps the
  // walk off the whole part per wrapper.
  const unformedEdges = {
    from: {
      earliestEnd: Number.POSITIVE_INFINITY,
      latestStart: Number.NEGATIVE_INFINITY,
    },
    to: {
      earliestEnd: Number.POSITIVE_INFINITY,
      latestStart: Number.NEGATIVE_INFINITY,
    },
  }
  for (const element of elements) {
    if (formedMarkers.has(element)) continue
    for (const side of ['from', 'to'] as const) {
      if (isWord(element, MARKER_NAMES[side].start)) {
        const edges = unformedEdges[side]
        if (element.end < edges.earliestEnd) edges.earliestEnd = element.end
      } else if (isWord(element, MARKER_NAMES[side].end)) {
        const edges = unformedEdges[side]
        if (element.start > edges.latestStart) edges.latestStart = element.start
      }
    }
  }

  function uncontaineredSafe(wrapper: XmlElement) {
    const covered = (element: XmlElement) =>
      element.start >= wrapper.startTagEnd && element.end <= wrapper.endTagStart
    for (
      let index = firstAtOrAfter(wrapper.startTagEnd);
      index < elements.length;
      index += 1
    ) {
      const element = elements[index]
      if (element === undefined || element.start > wrapper.endTagStart) break
      if (!covered(element)) continue
      if (MOVE_RANGE_MARKERS.has(element.localName)) return false
      if (!RANGE_MARKER_NAMES.has(element.localName)) continue
      const mate = markerMates.get(element)
      if (mate && !covered(mate)) return false
    }
    return !(['from', 'to'] as const).some((side) => {
      const edges = unformedEdges[side]
      return (
        edges.earliestEnd <= wrapper.start && edges.latestStart >= wrapper.end
      )
    })
  }

  // The innermost container is asked for once per wrapper, so the containers are
  // sorted once in the order that choice needs — latest start first, then
  // earliest end — and a query walks back from the last start at or before the
  // element. Sorting them per query made a document with many moves cost
  // wrappers × containers log containers.
  const innermostOrder = [...containers].sort(
    (left, right) =>
      right.start.start - left.start.start || left.end.end - right.end.end,
  )
  function innermost(element: XmlElement) {
    let low = 0
    let high = innermostOrder.length
    while (low < high) {
      const middle = (low + high) >> 1
      const container = innermostOrder[middle]
      if (container !== undefined && container.start.start > element.start)
        low = middle + 1
      else high = middle
    }
    for (let index = low; index < innermostOrder.length; index += 1) {
      const container = innermostOrder[index]
      if (container === undefined) break
      if (
        element.start >= container.start.end &&
        element.end <= container.end.start
      ) {
        return container
      }
    }
    return undefined
  }

  function member(element: XmlElement): MoveMembership {
    // Nested containers associate a wrapper with the innermost — the last
    // valid container start surrounding it in document order.
    const inner = innermost(element)
    if (!inner) {
      return uncontaineredSafe(element)
        ? { kind: 'uncontainered' }
        : { kind: 'blocked' }
    }
    const side = element.localName === 'moveFrom' ? 'from' : 'to'
    if (inner.side !== side || !inner.clean || blockedNames.has(inner.name)) {
      return { kind: 'blocked' }
    }
    return {
      kind: 'member',
      key: `name:${partName}:${inner.name}`,
      markers: markerRanges.get(inner.name) ?? [],
    }
  }

  return { member }
}

// A start and an end marker pair by shared w:id, zipped in the order each
// side appears. Ordering is not enforced — a malformed end-before-start
// shape still names a mate, so the clean check above sees the straddle
// rather than treating a real mate as a lone marker.
function pairRangeMarkers(elements: readonly XmlElement[]) {
  const mates = new Map<XmlElement, XmlElement>()
  for (const [startName, endName] of PAIRED_RANGE_MARKERS) {
    const byId = new Map<string, { starts: XmlElement[]; ends: XmlElement[] }>()
    for (const element of elements) {
      const side = isWord(element, startName)
        ? 'starts'
        : isWord(element, endName)
          ? 'ends'
          : undefined
      if (!side) continue
      const id = attributeValue(element, WORD_NAMESPACE, 'id')
      if (id === undefined) continue
      const entry = byId.get(id) ?? { starts: [], ends: [] }
      entry[side].push(element)
      byId.set(id, entry)
    }
    for (const { starts, ends } of byId.values()) {
      for (
        let index = 0;
        index < Math.min(starts.length, ends.length);
        index += 1
      ) {
        const start = starts[index]
        const end = ends[index]
        if (!start || !end) continue
        mates.set(start, end)
        mates.set(end, start)
      }
    }
  }
  return mates
}
