import type {
  DocumentParagraphWire,
  DocumentStoryKind,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type {
  ModelIdAllocator,
  ParagraphAnchor,
  TextRunAnchor,
  TrackedChangeOverlay,
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
}

export type ParsedStory = {
  story: DocumentStoryWire
  anchors: TextRunAnchor[]
  paragraphAnchors: ParagraphAnchor[]
  trackedChanges: TrackedChangeOverlay[]
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
  const trackedChanges = elements
    .filter(isTrackedChange)
    .filter((element) => !hasTrackedChangeAncestor(element))
    .map((element) => trackedChange(source, element))

  for (const paragraph of elements.filter(
    (element) => isWord(element, 'p') && !hasTrackedChangeAncestor(element),
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

  return {
    story: {
      partName,
      kind,
      paragraphs,
      preservedXmlFragments: [
        ...storyStructureFragments(source, elements, kind),
        ...trackedChanges.map(({ sourceFragment }) => sourceFragment),
      ],
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
  const runs: DocumentTextRunWire[] = []
  const anchors: TextRunAnchor[] = []
  const runElements = elements.filter(
    (element) =>
      isWord(element, 'r') &&
      isDescendantOf(element, paragraphElement) &&
      !hasTrackedChangeAncestor(element),
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
    runs,
    preservedXmlFragments: elements
      .filter(
        (element) =>
          element.parent === paragraphElement && !isWord(element, 'r'),
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
      isDescendantOf(element, runElement) &&
      !hasTrackedChangeAncestor(element),
  )
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
    text: textRanges
      .map(({ start, end }) => decodeXmlReferences(source.slice(start, end)))
      .join(''),
    preservedXmlFragments: elements
      .filter(
        (element) => element.parent === runElement && !isWord(element, 't'),
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
      runProperties: elements
        .filter(
          (element) => element.parent === runElement && isWord(element, 'rPr'),
        )
        .map((element) => elementFragment(source, element)),
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
        !isWord(element, 'body'),
    )
    .map((element) => elementFragment(source, element))
}

function trackedChange(source: string, element: XmlElement) {
  const elementName = trackedChangeName(element.localName)
  if (!elementName) throw new Error('Unknown tracked-change element')
  const author = attributeValue(element, WORD_NAMESPACE, 'author')
  const date = attributeValue(element, WORD_NAMESPACE, 'date')
  return {
    elementName,
    ...(author ? { author } : {}),
    ...(date ? { date } : {}),
    sourceFragment: elementFragment(source, element),
  }
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
): TrackedChangeOverlay['elementName'] | undefined {
  if (value === 'ins') return value
  if (value === 'del') return value
  if (value === 'moveFrom') return value
  if (value === 'moveTo') return value
  if (value === 'pPrChange') return value
  if (value === 'rPrChange') return value
  return undefined
}

function hasTrackedChangeAncestor(element: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (isTrackedChange(parent)) return true
    parent = parent.parent
  }
  return false
}
