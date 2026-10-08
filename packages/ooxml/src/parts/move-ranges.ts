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
// pair halves by a shared w:id, which the caller handles as a fallback.
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
  | { kind: 'blocked' }
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
  for (const container of containers) {
    const memberName = container.side === 'from' ? 'moveFrom' : 'moveTo'
    const inside = (element: XmlElement) =>
      element.start >= container.start.end && element.end <= container.end.start
    container.clean = elements.every((element) => {
      if (!inside(element)) return true
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
        return true
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
      return true
    })
  }

  const blockedNames = new Set(
    containers.filter((container) => !container.clean).map(({ name }) => name),
  )
  const markerRanges = new Map<string, XmlElementRange[]>()
  for (const container of containers) {
    const ranges = markerRanges.get(container.name) ?? []
    ranges.push(elementRange(container.start), elementRange(container.end))
    markerRanges.set(container.name, ranges)
  }

  function member(element: XmlElement): MoveMembership {
    // Nested containers associate a wrapper with the innermost — the last
    // valid container start surrounding it in document order.
    const inner = containers
      .filter(
        (container) =>
          element.start >= container.start.end &&
          element.end <= container.end.start,
      )
      .sort(
        (left, right) =>
          right.start.start - left.start.start || left.end.end - right.end.end,
      )[0]
    if (!inner) return { kind: 'uncontainered' }
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
