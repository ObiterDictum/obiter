import {
  trackedDisplaySegments,
  trackedElementText,
} from './tracked-change-display'
import type { DocumentChangeWire } from '@obiter/contracts'

import type { ParagraphAnchor, TrackedChangeNode } from '../model'
import type { MoveRangeIndex } from './move-ranges'
import { elementFragment } from './overlay'
import {
  attributeValue,
  elementRange,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'

// Tracked-change elements are parsed as opaque subtrees by the story parser and
// exposed as `TrackedChangeNode` records. `isTrackedChange` is the single owner
// of "is this element a tracked change"; the story parser's hot walk
// precomputes the ancestor and subtree answers from it (`PartIndex` in
// stories.ts) instead of re-walking the part per paragraph.
const TRACKED_CHANGE_NAMES = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'pPrChange',
  'rPrChange',
])

export function isTrackedChange(element: XmlElement) {
  return (
    element.namespaceUri === WORD_NAMESPACE &&
    TRACKED_CHANGE_NAMES.has(element.localName)
  )
}

function trackedChangeName(
  value: string,
): TrackedChangeNode['wire']['elementName'] | undefined {
  if (value === 'ins') return value
  if (value === 'del') return value
  if (value === 'moveFrom') return value
  if (value === 'moveTo') return value
  if (value === 'pPrChange') return value
  if (value === 'rPrChange') return value
  return undefined
}

export function nearestTrackedChangeAncestor(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (isTrackedChange(parent)) return parent
    parent = parent.parent
  }
  return undefined
}

const NO_ELEMENTS: readonly XmlElement[] = []

/**
 * What reading one part's tracked changes needs from the part, worked out once.
 * Each change used to answer two questions by walking the whole part — which
 * elements sit inside it, and which paragraph is the smallest one holding it —
 * so a part with many changes cost changes × elements for both. `elements` is in
 * document order, so one pass builds the element buckets and one sort of the
 * paragraph ranges answers every containment question.
 */
export type TrackedChangeLookup = {
  /** The elements whose nearest tracked-change ancestor is this change. A
   * change nested in another belongs to the outer one, never to itself, which
   * is what `nearestTrackedChangeAncestor` answers for its own parent. */
  inside(element: XmlElement): readonly XmlElement[]
  /** The direct children of this element, so a properties parent is a lookup
   * rather than a scan of the part. */
  childrenOf(element: XmlElement): readonly XmlElement[]
  /** The innermost paragraph range containing this element, if any. */
  paragraphAt(element: XmlElement): ParagraphAnchor | undefined
}

export function trackedChangeLookup(
  elements: readonly XmlElement[],
  paragraphs: readonly ParagraphAnchor[],
): TrackedChangeLookup {
  const inside = new Map<XmlElement, XmlElement[]>()
  const children = new Map<XmlElement, XmlElement[]>()
  for (const element of elements) {
    const parent = element.parent
    if (parent !== undefined) {
      const siblings = children.get(parent)
      if (siblings) siblings.push(element)
      else children.set(parent, [element])
    }
    const nearest = nearestTrackedChangeAncestor(element)
    if (nearest !== undefined) {
      const contained = inside.get(nearest)
      if (contained) contained.push(element)
      else inside.set(nearest, [element])
    }
  }
  // Paragraph ranges come from the part's tree, so any two are nested or
  // disjoint. The innermost range holding an element is therefore the one with
  // the last start that still holds it, and the ranges that could hold it are
  // exactly its enclosing chain. Following that chain is what keeps a change no
  // range covers — one inside a paragraph whose mark is deleted, a row-level
  // insert — from walking every earlier range before answering that nothing
  // holds it.
  const ordered = [...paragraphs].sort(
    (left, right) => left.paragraphRange.start - right.paragraphRange.start,
  )
  const enclosing = nearestEnclosing(ordered)
  return {
    inside: (element) => inside.get(element) ?? NO_ELEMENTS,
    childrenOf: (element) => children.get(element) ?? NO_ELEMENTS,
    paragraphAt: (element) => {
      let low = 0
      let high = ordered.length
      while (low < high) {
        const middle = (low + high) >> 1
        const anchor = ordered[middle]
        if (
          anchor !== undefined &&
          anchor.paragraphRange.start <= element.start
        )
          low = middle + 1
        else high = middle
      }
      for (let index = low - 1; index >= 0; index = enclosing[index] ?? -1) {
        const anchor = ordered[index]
        if (anchor === undefined) return undefined
        if (
          anchor.paragraphRange.start <= element.start &&
          anchor.paragraphRange.end >= element.end
        ) {
          return anchor
        }
      }
      return undefined
    },
  }
}

/**
 * For each range in a start-sorted, nested-or-disjoint list, the index of the
 * nearest earlier range that encloses it, or -1 when none does. One stack pass:
 * a range is enclosed by the last range still open past its start.
 */
function nearestEnclosing(ordered: readonly ParagraphAnchor[]): number[] {
  const enclosing: number[] = []
  const open: number[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    const end = ordered[index]?.paragraphRange.end
    if (end === undefined) continue
    // Starts ascend, so every range on the stack begins at or before this one:
    // it encloses this range exactly when it also ends at or after it. Ranges
    // that merely touch — one ending where the next begins — do not, and
    // treating them as enclosing would make the chain step through every
    // sibling, which is the walk this exists to avoid.
    while (open.length > 0) {
      const candidate = ordered[open[open.length - 1] ?? -1]
      if (candidate !== undefined && candidate.paragraphRange.end >= end) break
      open.pop()
    }
    enclosing.push(open.length > 0 ? (open[open.length - 1] ?? -1) : -1)
    open.push(index)
  }
  return enclosing
}

function isParagraphMarkDeletion(element: XmlElement) {
  return (
    isWord(element, 'del') &&
    !!element.parent &&
    isWord(element.parent, 'rPr') &&
    !!element.parent.parent &&
    isWord(element.parent.parent, 'pPr')
  )
}

// A moveFrom/moveTo carried on a paragraph mark (the block-move shape) is not
// a run-content wrapper: deciding it means removing or reviving a whole w:p,
// which the member-wise decision path does not implement.
export function isParagraphMarkMove(element: XmlElement) {
  return (
    (isWord(element, 'moveFrom') || isWord(element, 'moveTo')) &&
    !!element.parent &&
    isWord(element.parent, 'rPr') &&
    !!element.parent.parent &&
    isWord(element.parent.parent, 'pPr')
  )
}

type ChangeWireCommon = Pick<
  DocumentChangeWire,
  'id' | 'storyPartName' | 'text' | 'inlinePosition'
> &
  Partial<
    Pick<
      DocumentChangeWire,
      'ooxmlId' | 'author' | 'date' | 'paragraphId' | 'runId'
    >
  >

function changeWire(
  elementName: DocumentChangeWire['elementName'],
  common: ChangeWireCommon,
): DocumentChangeWire {
  if (elementName === 'ins') {
    return { ...common, kind: 'insert', elementName }
  }
  if (elementName === 'del') {
    return { ...common, kind: 'delete', elementName }
  }
  if (elementName === 'moveFrom') {
    return { ...common, kind: 'move', elementName, direction: 'from' }
  }
  if (elementName === 'moveTo') {
    return { ...common, kind: 'move', elementName, direction: 'to' }
  }
  if (elementName === 'rPrChange') {
    return { ...common, kind: 'property', elementName, scope: 'run' }
  }
  return { ...common, kind: 'property', elementName, scope: 'paragraph' }
}

export function trackedChange(
  partName: string,
  source: string,
  element: XmlElement,
  lookup: TrackedChangeLookup,
  id: string,
  moveRanges: MoveRangeIndex,
  hyperlinkTargets?: ReadonlyMap<string, string>,
): TrackedChangeNode {
  const elementName = trackedChangeName(element.localName)
  if (!elementName) throw new Error('Unknown tracked-change element')
  const author = attributeValue(element, WORD_NAMESPACE, 'author')
  const date = attributeValue(element, WORD_NAMESPACE, 'date')
  const ooxmlId = attributeValue(element, WORD_NAMESPACE, 'id')
  const paragraph = lookup.paragraphAt(element)
  const paragraphMark = isParagraphMarkDeletion(element)
    ? nearestWordAncestor(element, 'p')
    : undefined
  const run = paragraph?.runs.find(
    ({ runRange }) =>
      runRange.start <= element.start && runRange.end >= element.end,
  )
  const textElements = lookup
    .inside(element)
    .filter(
      (candidate) =>
        isWord(candidate, 't') ||
        isWord(candidate, 'delText') ||
        isWord(candidate, 'tab') ||
        isWord(candidate, 'br') ||
        isWord(candidate, 'cr'),
    )
  const wire = changeWire(elementName, {
    id,
    inlinePosition:
      paragraph &&
      !nearestWordAncestor(element, 'pPr') &&
      !nearestWordAncestor(element, 'rPr') &&
      elementName !== 'pPrChange' &&
      elementName !== 'rPrChange'
        ? {
            segments: trackedDisplaySegments(
              source,
              element,
              lookup.childrenOf,
              hyperlinkTargets,
            ),
            beforeRunId:
              paragraph.runs.find(
                ({ runRange }) => runRange.start >= element.end,
              )?.wire.id ?? null,
          }
        : null,
    ...(ooxmlId !== undefined ? { ooxmlId } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(date !== undefined ? { date } : {}),
    storyPartName: partName,
    ...(paragraph ? { paragraphId: paragraph.wire.id } : {}),
    ...(run ? { runId: run.wire.id } : {}),
    text: textElements
      .map((candidate) => trackedElementText(source, candidate))
      .join(''),
  })
  const expectedPropertiesName =
    elementName === 'rPrChange'
      ? 'rPr'
      : elementName === 'pPrChange'
        ? 'pPr'
        : undefined
  const propertiesParent =
    expectedPropertiesName &&
    element.parent &&
    isWord(element.parent, expectedPropertiesName)
      ? element.parent
      : undefined
  const previousProperties = expectedPropertiesName
    ? lookup
        .childrenOf(element)
        .find((candidate) => isWord(candidate, expectedPropertiesName))
    : undefined
  // Word pairs a move by the shared w:name on its range containers; a wrapper
  // outside any container is tolerated markup paired by a shared w:id.
  // Anything else stays ungrouped, which is what makes it undecidable.
  let moveGroup: string | undefined
  let moveMarkers: TrackedChangeNode['moveMarkers']
  if (
    (elementName === 'moveFrom' || elementName === 'moveTo') &&
    !isParagraphMarkMove(element)
  ) {
    const membership = moveRanges.member(element)
    if (membership.kind === 'member') {
      moveGroup = membership.key
      moveMarkers = membership.markers
    } else if (membership.kind === 'uncontainered' && ooxmlId !== undefined) {
      moveGroup = `id:${ooxmlId}`
    }
  }
  return {
    wire,
    partName,
    range: elementRange(element),
    ...(moveGroup !== undefined ? { moveGroup } : {}),
    ...(moveMarkers !== undefined ? { moveMarkers } : {}),
    ...(propertiesParent
      ? { propertiesRange: elementRange(propertiesParent) }
      : {}),
    sourceFragment: elementFragment(source, element),
    innerFragment: source.slice(element.startTagEnd, element.endTagStart),
    ...(previousProperties
      ? {
          previousPropertiesFragment: elementFragment(
            source,
            previousProperties,
          ),
        }
      : {}),
    validMoveCounterpart: false,
    deletedTextElements: textElements
      .filter((candidate) => isWord(candidate, 'delText'))
      .map((candidate) => ({
        range: elementRange(candidate),
        qualifiedName: candidate.qualifiedName,
      })),
    ...(paragraphMark
      ? { paragraphMarkRange: elementRange(paragraphMark) }
      : {}),
  }
}
