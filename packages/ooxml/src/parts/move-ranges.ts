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

// Point-in-range markup that comes in matched pairs. One half inside a
// decided container with the other outside would strand an orphan.
const RANGE_MARKER_NAMES = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'permStart',
  'permEnd',
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

  // A container is decidable only when everything it carries is content a
  // member wrapper owns: every tracked-change element, run or paragraph fully
  // inside it must sit inside a same-side moveFrom/moveTo wrapper. A bare run
  // or a paragraph-mark move (the block-move shape) or a foreign change in
  // the range would survive a member-wise decision stranded, so the whole
  // group stays undecidable instead.
  for (const container of containers) {
    const memberName = container.side === 'from' ? 'moveFrom' : 'moveTo'
    container.clean = elements.every((element) => {
      if (
        element.start < container.start.end ||
        element.end > container.end.start
      ) {
        return true
      }
      // Paired range markers are container-bearing too: one half inside the
      // range with its mate outside would strand markup the decision leaves
      // behind, so the container stays undecidable. Nested move containers
      // trip the same rule — a shape Word does not produce and a decision
      // here would corrupt. proofErr is a lone point hint, not a range, and
      // Word scatters it freely, so it is allowed through.
      if (
        !isTrackedChange(element) &&
        !isWord(element, 'r') &&
        !isWord(element, 'p') &&
        !RANGE_MARKER_NAMES.has(element.localName)
      ) {
        return true
      }
      let current: XmlElement | undefined = element
      while (current) {
        if (isTrackedChange(current)) {
          return isWord(current, memberName) && !isParagraphMarkMove(current)
        }
        current = current.parent
      }
      return false
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
