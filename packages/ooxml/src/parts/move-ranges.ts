import type { XmlElementRange } from '../model'
import {
  attributeValue,
  elementRange,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'
import { isParagraphMarkMove, isTrackedChange } from './tracked-change-nodes'

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

  const markerMates = pairRangeMarkers(elements)

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
      if (MOVE_RANGE_MARKERS.has(element.localName)) return false
      const isRangeMarker = RANGE_MARKER_NAMES.has(element.localName)
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
