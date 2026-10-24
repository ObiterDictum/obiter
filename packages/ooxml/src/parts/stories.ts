import { trackedElementText } from './tracked-change-display'
import { PartIndex } from './story-index'
import { isSplittableRun } from '../run-revision-eligibility'
import { runHyperlinkTarget } from './hyperlink-target'
import {
  type DocumentFieldWire,
  type DocumentParagraphWire,
  type DocumentStoryKind,
  type DocumentStoryWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

import {
  fieldSpans,
  nestedFieldSpans,
  spanRangeReplaceable,
} from '../field-spans'
import type {
  ModelIdAllocator,
  ParagraphAnchor,
  TextRunAnchor,
  TrackedChangeNode,
} from '../model'
import { decodeXmlReferences } from '../xml-lexemes'
import { resolveMoveRanges } from './move-ranges'
import { elementFragment, parseXmlElements } from './overlay'
import {
  isTrackedChange,
  trackedChange,
  trackedChangeLookup,
} from './tracked-change-nodes'
import {
  attributeValue,
  elementRange,
  isTextWrappingBreak,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'
const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'

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
  hyperlinkTargets?: ReadonlyMap<string, string>,
): ParsedStory {
  const elements = parseXmlElements(source)
  const paragraphs: DocumentParagraphWire[] = []
  const anchors: TextRunAnchor[] = []
  const paragraphAnchors: ParagraphAnchor[] = []

  const index = new PartIndex(elements)
  for (const paragraph of elements.filter(
    (element) =>
      isWord(element, 'p') &&
      !index.inTrackedChange(element) &&
      !index.hasDeletedParagraphMark(element) &&
      !index.isInsideFallback(element),
  )) {
    const parsed = parseParagraph(
      partName,
      source,
      index,
      paragraph,
      identity,
      hyperlinkTargets,
    )
    paragraphs.push(parsed.paragraph)
    anchors.push(...parsed.anchors)
    paragraphAnchors.push(parsed.anchor)
  }

  const moveRanges = resolveMoveRanges(partName, elements)
  // The lookup answers a question per change, so it is built once for the part
  // rather than re-scanned inside every change.
  const trackedLookup = trackedChangeLookup(elements, paragraphAnchors)
  const trackedChanges = elements
    .filter(isTrackedChange)
    .filter((element) => !index.inTrackedChange(element))
    .map((element) =>
      trackedChange(
        partName,
        source,
        element,
        trackedLookup,
        identity.nextChangeId(),
        moveRanges,
        hyperlinkTargets,
      ),
    )

  const { fields, unanchoredFieldParagraphIds } = storyFields(
    source,
    elements,
    paragraphAnchors,
  )

  return {
    story: {
      partName,
      kind,
      paragraphs,
      preservedXmlFragments: storyStructureFragments(source, index, kind),
      fields,
      unanchoredFieldParagraphIds,
    },
    anchors,
    paragraphAnchors,
    trackedChanges,
  }
}

/**
 * The part's stored fields lowered onto the wire. Pairing and shape facts
 * are only computable here, while element parentage and sibling order
 * still exist: `headId`/`tailId`/`boundaryIds`/`paragraphIds` name the
 * wire ids of the paragraphs the span covers, `instruction` carries the
 * decoded field text for classification, and `rangeReplaceable` proves the
 * shape an in-place refresh rewrites. A field whose carriers the model
 * cannot all name — a marker inside tracked markup the wire drops, or one
 * floating outside every `w:p` — records `boundariesAnchored: false`; a
 * field whose very head is unmodelled cannot name an anchor at all, so its
 * modelled carriers land in `unanchoredFieldParagraphIds` and any deletion
 * touching them is refused outright.
 */
function storyFields(
  source: string,
  elements: XmlElement[],
  paragraphAnchors: readonly ParagraphAnchor[],
) {
  const ids = new Map(
    paragraphAnchors.map((anchor) => [
      anchor.paragraphRange.start,
      anchor.wire.id,
    ]),
  )
  const carrierId = (element: XmlElement | undefined) =>
    element === undefined ? undefined : ids.get(element.start)
  const fields: DocumentFieldWire[] = []
  const unanchored = new Set<string>()
  const spans = fieldSpans(elements, source)
  // Nested decides `rangeReplaceable` per field, so it is worked out for all of
  // them once rather than re-asked of every field against every other field.
  const nestedSpans = nestedFieldSpans(spans)
  for (const span of spans) {
    const boundaryIds = span.boundaryParagraphs.flatMap((element) => {
      const id = ids.get(element.start)
      return id === undefined ? [] : [id]
    })
    const headId = carrierId(span.beginParagraph)
    if (headId === undefined) {
      for (const id of boundaryIds) unanchored.add(id)
      continue
    }
    const tailId = carrierId(span.endParagraph)
    const paragraphIds = span.rangeParagraphs.flatMap((element) => {
      const id = ids.get(element.start)
      return id === undefined ? [] : [id]
    })
    fields.push({
      headId,
      ...(tailId === undefined ? {} : { tailId }),
      closed: span.end !== undefined,
      boundaryIds,
      paragraphIds,
      resultIds: paragraphIds.filter((id) => id !== tailId),
      instruction: span.instruction,
      rangeReplaceable:
        spanRangeReplaceable(span) &&
        !nestedSpans.has(span) &&
        tailId !== undefined &&
        paragraphIds.length === span.rangeParagraphs.length,
      boundariesAnchored:
        !span.boundaryUnanchored &&
        boundaryIds.length === span.boundaryParagraphs.length,
    })
  }
  return { fields, unanchoredFieldParagraphIds: [...unanchored] }
}

function parseParagraph(
  partName: string,
  source: string,
  index: PartIndex,
  paragraphElement: XmlElement,
  identity: IdentityContext,
  hyperlinkTargets: ReadonlyMap<string, string> | undefined,
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
  const propertiesElement = index
    .childrenOf(paragraphElement)
    .find((element) => isWord(element, 'pPr'))
  const styleElement = propertiesElement
    ? index
        .childrenOf(propertiesElement)
        .find((element) => isWord(element, 'pStyle'))
    : undefined
  const styleId = styleElement
    ? attributeValue(styleElement, WORD_NAMESPACE, 'val')
    : undefined
  const runs: DocumentTextRunWire[] = []
  const anchors: TextRunAnchor[] = []
  const runElements = index
    .descendantsOfParagraph(paragraphElement)
    .filter(
      (element) =>
        isWord(element, 'r') &&
        !index.inTrackedChange(element) &&
        !index.isInsideFallback(element),
    )

  runElements.forEach((runElement, runIndex) => {
    const parsed = parseRun(
      partName,
      source,
      index,
      runElement,
      runIndex === 0 ? sourceTextId : undefined,
      identity,
      hyperlinkTargets,
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
    preservedXmlFragments: index
      .childrenOf(paragraphElement)
      .filter(
        (element) =>
          !isWord(element, 'r') && !index.containsTrackedChange(element),
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
      hasTrackedChanges: index.containsTrackedChange(paragraphElement),
      runs: anchors,
    } satisfies ParagraphAnchor,
  }
}

function parseRun(
  partName: string,
  source: string,
  index: PartIndex,
  runElement: XmlElement,
  paragraphTextId: string | undefined,
  identity: IdentityContext,
  hyperlinkTargets: ReadonlyMap<string, string> | undefined,
) {
  const sourceTextId =
    attributeValue(runElement, WORD_2010_NAMESPACE, 'textId') ?? paragraphTextId
  const id = uniqueId(
    sourceTextId
      ? `text-w14-${sourceTextId}`
      : identity.allocator.nextTextRunId(),
    identity,
  )
  const content = index.descendantsOfRun(runElement).filter(
    (element) => !index.inTrackedChange(element) && !index.isInsideFallback(element),
  )
  const textElements = content.filter((element) => isWord(element, 't'))
  const propertiesElements = index
    .childrenOf(runElement)
    .filter((element) => isWord(element, 'rPr'))
  const propertiesElement = propertiesElements[0]
  const styleElement = propertiesElement
    ? index
        .childrenOf(propertiesElement)
        .find((element) => isWord(element, 'rStyle'))
    : undefined
  const styleId = styleElement
    ? attributeValue(styleElement, WORD_NAMESPACE, 'val')
    : undefined
  const anchoredTextElements = textElements
    .filter((element) => !element.selfClosing)
    .map(elementRange)
  const textBreaks = content
    .filter(isTextWrappingBreak)
    .map(elementRange)
  const textRanges = anchoredTextElements.map((element) => ({
    start: element.startTagEnd,
    end: element.endTagStart,
  }))
  const hyperlinkTarget = runHyperlinkTarget(runElement, hyperlinkTargets)
  const wire: DocumentTextRunWire = {
    id,
    ...(sourceTextId ? { sourceTextId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(hyperlinkTarget ? { hyperlinkTarget } : {}),
    text: runPlainText(source, content, textElements),
    preservedXmlFragments: index
      .childrenOf(runElement)
      .filter(
        (element) =>
          !isWord(element, 't') &&
          !isTextWrappingBreak(element) &&
          !index.containsTrackedChange(element),
      )
      .map((element) => elementFragment(source, element)),
  }
  const anchor: TextRunAnchor = {
    partName,
    wire,
    runRange: elementRange(runElement),
    textRanges,
    textElements: anchoredTextElements,
    textBreaks,
    runProperties: propertiesElements.map((element) =>
      elementFragment(source, element),
    ),
    ...(propertiesElement
      ? { runPropertiesRange: elementRange(propertiesElement) }
      : {}),
    ...(styleElement ? { runStyleRange: elementRange(styleElement) } : {}),
  }
  wire.textRevisionEligible =
    !propertiesElements.some((element) =>
      index.containsTrackedChange(element),
    ) && isSplittableRun(source, anchor)
  if (!wire.textRevisionEligible) {
    const anchored = new Set(
      anchoredTextElements.map((element) => element.start),
    )
    const consumed = new Set(textBreaks.map((element) => element.start))
    let offset = 0
    let textIndex = 0
    wire.textRevisionTokens = []
    wire.textRevisionTextRanges = []
    for (const element of content) {
      if (
        !['t', 'delText', 'tab', 'br', 'cr'].some((name) =>
          isWord(element, name),
        )
      )
        continue
      const text = trackedElementText(source, element)
      if (anchored.has(element.start)) {
        wire.textRevisionTextRanges.push({
          from: offset,
          to: offset + text.length,
        })
        offset += text.length
        textIndex += 1
      } else if (consumed.has(element.start)) {
        offset += text.length
      } else {
        wire.textRevisionTokens.push({
          kind: 'retained',
          offset,
          textIndex,
          text,
        })
      }
    }
  }
  return { wire, anchor }
}

function runPlainText(
  source: string,
  content: readonly XmlElement[],
  textElements: readonly XmlElement[],
) {
  const textNodes = new Set(
    textElements.filter((element) => !element.selfClosing),
  )
  const parts: string[] = []
  for (const element of content) {
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
  index: PartIndex,
  kind: DocumentStoryKind,
) {
  const root = index.root()
  if (!root) return []
  const container =
    kind === 'document'
      ? index.childrenOf(root).find((element) => isWord(element, 'body'))
      : root
  if (!container) return []
  return index
    .childrenOf(container)
    .filter(
      (element) =>
        !isWord(element, 'p') &&
        !isWord(element, 'body') &&
        !index.containsTrackedChange(element),
    )
    .map((element) => elementFragment(source, element))
}

function uniqueId(candidate: string, identity: IdentityContext) {
  let id = candidate
  while (identity.usedIds.has(id))
    id = `${candidate}-${identity.allocator.nextTextRunId()}`
  identity.usedIds.add(id)
  return id
}
