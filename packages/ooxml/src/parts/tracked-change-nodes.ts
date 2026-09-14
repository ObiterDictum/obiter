import type { DocumentChangeWire } from '@obiter/contracts'

import type { ParagraphAnchor, TrackedChangeNode } from '../model'
import { decodeXmlReferences } from '../xml-lexemes'
import { elementFragment } from './overlay'
import {
  attributeValue,
  elementRange,
  isDescendantOf,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'

// Tracked-change elements are parsed as opaque subtrees by the story parser and
// exposed as `TrackedChangeNode` records. The predicates here are the single
// owner of "is this node inside a tracked change", used both by this module and
// by the story parser when it skips tracked content.
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

export function containsTrackedChange(
  element: XmlElement,
  elements: readonly XmlElement[],
) {
  return (
    isTrackedChange(element) ||
    elements.some(
      (candidate) =>
        isTrackedChange(candidate) && isDescendantOf(candidate, element),
    )
  )
}

export function hasTrackedChangeAncestor(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (isTrackedChange(parent)) return true
    parent = parent.parent
  }
  return false
}

export function hasDeletedParagraphMark(
  paragraph: XmlElement,
  elements: readonly XmlElement[],
) {
  const properties = elements.find(
    (element) => element.parent === paragraph && isWord(element, 'pPr'),
  )
  if (!properties) return false
  const markProperties = elements.find(
    (element) => element.parent === properties && isWord(element, 'rPr'),
  )
  if (!markProperties) return false
  return elements.some(
    (element) => element.parent === markProperties && isWord(element, 'del'),
  )
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

type ChangeWireCommon = Pick<
  DocumentChangeWire,
  'id' | 'storyPartName' | 'text'
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
  elements: XmlElement[],
  element: XmlElement,
  paragraphs: ParagraphAnchor[],
  id: string,
): TrackedChangeNode {
  const elementName = trackedChangeName(element.localName)
  if (!elementName) throw new Error('Unknown tracked-change element')
  const author = attributeValue(element, WORD_NAMESPACE, 'author')
  const date = attributeValue(element, WORD_NAMESPACE, 'date')
  const ooxmlId = attributeValue(element, WORD_NAMESPACE, 'id')
  const paragraph = smallestContainingParagraph(paragraphs, element)
  const paragraphMark = isParagraphMarkDeletion(element)
    ? nearestWordAncestor(element, 'p')
    : undefined
  const run = paragraph?.runs.find(
    ({ runRange }) =>
      runRange.start <= element.start && runRange.end >= element.end,
  )
  const textName =
    elementName === 'del' || elementName === 'moveFrom' ? 'delText' : 't'
  const textElements = elements.filter(
    (candidate) =>
      isWord(candidate, textName) &&
      isDescendantOf(candidate, element) &&
      nearestTrackedChangeAncestor(candidate) === element,
  )
  const wire = changeWire(elementName, {
    id,
    ...(ooxmlId !== undefined ? { ooxmlId } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(date !== undefined ? { date } : {}),
    storyPartName: partName,
    ...(paragraph ? { paragraphId: paragraph.wire.id } : {}),
    ...(run ? { runId: run.wire.id } : {}),
    text: textElements
      .filter((candidate) => !candidate.selfClosing)
      .map((candidate) =>
        decodeXmlReferences(
          source.slice(candidate.startTagEnd, candidate.endTagStart),
        ),
      )
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
    ? elements.find(
        (candidate) =>
          candidate.parent === element &&
          isWord(candidate, expectedPropertiesName),
      )
    : undefined
  return {
    wire,
    partName,
    range: elementRange(element),
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
    deletedTextElements: textElements.map((candidate) => ({
      range: elementRange(candidate),
      qualifiedName: candidate.qualifiedName,
    })),
    ...(paragraphMark
      ? { paragraphMarkRange: elementRange(paragraphMark) }
      : {}),
  }
}

function smallestContainingParagraph(
  paragraphs: ParagraphAnchor[],
  element: XmlElement,
) {
  return paragraphs
    .filter(
      ({ paragraphRange }) =>
        paragraphRange.start <= element.start &&
        paragraphRange.end >= element.end,
    )
    .sort(
      (left, right) =>
        left.paragraphRange.end -
        left.paragraphRange.start -
        (right.paragraphRange.end - right.paragraphRange.start),
    )[0]
}
