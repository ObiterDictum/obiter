import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentStoryKind,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type {
  ModelIdAllocator,
  ParagraphAnchor,
  TextRunAnchor,
  TrackedChangeNode,
} from '../model'
import { decodeXmlReferences } from '../xml-lexemes'
import { elementFragment, parseXmlElements } from './overlay'
import {
  attributeValue,
  isDescendantOf,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'
const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'
const TRACKED_CHANGE_NAMES = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'pPrChange',
  'rPrChange',
])

export type IdentityContext = {
  allocator: ModelIdAllocator
  usedIds: Set<string>
  nextChangeId(): string
}

export type ParsedStory = {
  story: DocumentStoryWire
  anchors: TextRunAnchor[]
  paragraphAnchors: ParagraphAnchor[]
  trackedChanges: TrackedChangeNode[]
}

export function parseStory(
  partName: string,
  kind: DocumentStoryKind,
  source: string,
  identity: IdentityContext,
): ParsedStory {
  const elements = parseXmlElements(source)
  const paragraphs: DocumentParagraphWire[] = []
  const anchors: TextRunAnchor[] = []
  const paragraphAnchors: ParagraphAnchor[] = []

  for (const paragraph of elements.filter(
    (element) =>
      isWord(element, 'p') &&
      !hasTrackedChangeAncestor(element) &&
      !hasDeletedParagraphMark(element, elements) &&
      !isInsideFallback(element),
  )) {
    const parsed = parseParagraph(
      partName,
      source,
      elements,
      paragraph,
      identity,
    )
    paragraphs.push(parsed.paragraph)
    anchors.push(...parsed.anchors)
    paragraphAnchors.push(parsed.anchor)
  }

  const trackedChanges = elements
    .filter(isTrackedChange)
    .filter((element) => !hasTrackedChangeAncestor(element))
    .map((element) =>
      trackedChange(
        partName,
        source,
        elements,
        element,
        paragraphAnchors,
        identity.nextChangeId(),
      ),
    )

  return {
    story: {
      partName,
      kind,
      paragraphs,
      preservedXmlFragments: storyStructureFragments(source, elements, kind),
    },
    anchors,
    paragraphAnchors,
    trackedChanges,
  }
}

function parseParagraph(
  partName: string,
  source: string,
  elements: XmlElement[],
  paragraphElement: XmlElement,
  identity: IdentityContext,
) {
  const sourceParaId = attributeValue(
    paragraphElement,
    WORD_2010_NAMESPACE,
    'paraId',
  )
  const sourceTextId = attributeValue(
    paragraphElement,
    WORD_2010_NAMESPACE,
    'textId',
  )
  const id = uniqueId(
    sourceParaId
      ? `para-w14-${sourceParaId}`
      : identity.allocator.nextParagraphId(),
    identity,
  )
  const propertiesElement = elements.find(
    (element) => element.parent === paragraphElement && isWord(element, 'pPr'),
  )
  const styleElement = propertiesElement
    ? elements.find(
        (element) =>
          element.parent === propertiesElement && isWord(element, 'pStyle'),
      )
    : undefined
  const styleId = styleElement
    ? attributeValue(styleElement, WORD_NAMESPACE, 'val')
    : undefined
  const runs: DocumentTextRunWire[] = []
  const anchors: TextRunAnchor[] = []
  const runElements = elements.filter(
    (element) =>
      isWord(element, 'r') &&
      nearestWordAncestor(element, 'p') === paragraphElement &&
      !hasTrackedChangeAncestor(element) &&
      !isInsideFallback(element),
  )

  runElements.forEach((runElement, index) => {
    const parsed = parseRun(
      partName,
      source,
      elements,
      runElement,
      index === 0 ? sourceTextId : undefined,
      identity,
    )
    runs.push(parsed.wire)
    anchors.push(parsed.anchor)
  })

  const paragraph: DocumentParagraphWire = {
    id,
    ...(sourceParaId ? { sourceParaId } : {}),
    ...(sourceTextId ? { sourceTextId } : {}),
    ...(styleId ? { styleId } : {}),
    runs,
    preservedXmlFragments: elements
      .filter(
        (element) =>
          element.parent === paragraphElement &&
          !isWord(element, 'r') &&
          !containsTrackedChange(element, elements),
      )
      .map((element) => elementFragment(source, element)),
  }
  return {
    paragraph,
    anchors,
    anchor: {
      partName,
      wire: paragraph,
      paragraphRange: elementRange(paragraphElement),
      ...(propertiesElement
        ? { paragraphPropertiesRange: elementRange(propertiesElement) }
        : {}),
      ...(styleElement
        ? { paragraphStyleRange: elementRange(styleElement) }
        : {}),
      hasTrackedChanges: elements.some(
        (element) =>
          isTrackedChange(element) && isDescendantOf(element, paragraphElement),
      ),
      runs: anchors,
    } satisfies ParagraphAnchor,
  }
}

function parseRun(
  partName: string,
  source: string,
  elements: XmlElement[],
  runElement: XmlElement,
  paragraphTextId: string | undefined,
  identity: IdentityContext,
) {
  const sourceTextId =
    attributeValue(runElement, WORD_2010_NAMESPACE, 'textId') ?? paragraphTextId
  const id = uniqueId(
    sourceTextId
      ? `text-w14-${sourceTextId}`
      : identity.allocator.nextTextRunId(),
    identity,
  )
  const textElements = elements.filter(
    (element) =>
      isWord(element, 't') &&
      nearestWordAncestor(element, 'r') === runElement &&
      !hasTrackedChangeAncestor(element) &&
      !isInsideFallback(element),
  )
  const propertiesElements = elements.filter(
    (element) => element.parent === runElement && isWord(element, 'rPr'),
  )
  const propertiesElement = propertiesElements[0]
  const styleElement = propertiesElement
    ? elements.find(
        (element) =>
          element.parent === propertiesElement && isWord(element, 'rStyle'),
      )
    : undefined
  const styleId = styleElement
    ? attributeValue(styleElement, WORD_NAMESPACE, 'val')
    : undefined
  const anchoredTextElements = textElements
    .filter((element) => !element.selfClosing)
    .map(elementRange)
  const textRanges = anchoredTextElements.map((element) => ({
    start: element.startTagEnd,
    end: element.endTagStart,
  }))
  const wire: DocumentTextRunWire = {
    id,
    ...(sourceTextId ? { sourceTextId } : {}),
    ...(styleId ? { styleId } : {}),
    text: runPlainText(source, elements, runElement, textElements),
    preservedXmlFragments: elements
      .filter(
        (element) =>
          element.parent === runElement &&
          !isWord(element, 't') &&
          !isTextWrappingBreak(element) &&
          !containsTrackedChange(element, elements),
      )
      .map((element) => elementFragment(source, element)),
  }
  return {
    wire,
    anchor: {
      partName,
      wire,
      runRange: elementRange(runElement),
      textRanges,
      textElements: anchoredTextElements,
      runProperties: propertiesElements.map((element) =>
        elementFragment(source, element),
      ),
      ...(propertiesElement
        ? { runPropertiesRange: elementRange(propertiesElement) }
        : {}),
      ...(styleElement ? { runStyleRange: elementRange(styleElement) } : {}),
    },
  }
}

function elementRange(element: XmlElement) {
  return {
    start: element.start,
    startTagEnd: element.startTagEnd,
    endTagStart: element.endTagStart,
    end: element.end,
  }
}

function isTextWrappingBreak(element: XmlElement) {
  if (!isWord(element, 'br')) return false
  const type = attributeValue(element, WORD_NAMESPACE, 'type')
  return type === undefined || type === 'textWrapping'
}

function runPlainText(
  source: string,
  elements: readonly XmlElement[],
  runElement: XmlElement,
  textElements: readonly XmlElement[],
) {
  const textNodes = new Set(
    textElements.filter((element) => !element.selfClosing),
  )
  const parts: string[] = []
  for (const element of elements) {
    if (nearestWordAncestor(element, 'r') !== runElement) continue
    if (hasTrackedChangeAncestor(element) || isInsideFallback(element)) continue
    if (textNodes.has(element)) {
      parts.push(
        decodeXmlReferences(
          source.slice(element.startTagEnd, element.endTagStart),
        ),
      )
      continue
    }
    if (isTextWrappingBreak(element)) parts.push('\n')
  }
  return parts.join('')
}

function storyStructureFragments(
  source: string,
  elements: XmlElement[],
  kind: DocumentStoryKind,
) {
  const root = elements.find(({ depth }) => depth === 0)
  if (!root) return []
  const container =
    kind === 'document'
      ? elements.find(
          (element) => element.parent === root && isWord(element, 'body'),
        )
      : root
  if (!container) return []
  return elements
    .filter(
      (element) =>
        element.parent === container &&
        !isWord(element, 'p') &&
        !isWord(element, 'body') &&
        !containsTrackedChange(element, elements),
    )
    .map((element) => elementFragment(source, element))
}

function trackedChange(
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

function nearestTrackedChangeAncestor(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (isTrackedChange(parent)) return parent
    parent = parent.parent
  }
  return undefined
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

function uniqueId(candidate: string, identity: IdentityContext) {
  let id = candidate
  while (identity.usedIds.has(id))
    id = `${candidate}-${identity.allocator.nextTextRunId()}`
  identity.usedIds.add(id)
  return id
}

function isTrackedChange(element: XmlElement) {
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

function containsTrackedChange(
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

function hasTrackedChangeAncestor(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (isTrackedChange(parent)) return true
    parent = parent.parent
  }
  return false
}

function hasDeletedParagraphMark(
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

function nearestWordAncestor(element: XmlElement, localName: string) {
  let parent = element.parent
  while (parent) {
    if (isWord(parent, localName)) return parent
    parent = parent.parent
  }
  return undefined
}

function isInsideFallback(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (parent.localName === 'Fallback') return true
    parent = parent.parent
  }
  return false
}
