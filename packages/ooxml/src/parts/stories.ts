import {
  documentEditHyperlinkTargetSchema,
  type DocumentFieldWire,
  type DocumentParagraphWire,
  type DocumentStoryKind,
  type DocumentStoryWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

import {
  fieldSpans,
  spanNestedInField,
  spanRangeReplaceable,
} from '../field-spans'
import type {
  ModelIdAllocator,
  ParagraphAnchor,
  TextRunAnchor,
  TrackedChangeNode,
} from '../model'
import { RELATIONSHIPS_NAMESPACE } from '../structure-xml'
import { decodeXmlReferences } from '../xml-lexemes'
import { resolveMoveRanges } from './move-ranges'
import { elementFragment, parseXmlElements } from './overlay'
import { isTrackedChange, trackedChange } from './tracked-change-nodes'
import {
  attributeValue,
  elementRange,
  isTextWrappingBreak,
  isWord,
  nearestWordAncestor,
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

const NO_ELEMENTS: readonly XmlElement[] = []

/**
 * One pass over a part's element list, indexing what the story walk asks for
 * over and over: children, the nearest enclosing `w:r`/`w:p`, and the tracked
 * change and `mc:Fallback` facts. Without it every paragraph and every run
 * scans the whole list, so a part costs runs × elements — 2,000 field-bearing
 * paragraphs took ~30 s before this. Elements are in document order, so a
 * parent is always seen before its children: ancestor facts are computed
 * forward and subtree facts backward, with no recursion (a part may nest
 * 20,000 deep).
 */
class PartIndex {
  private readonly children = new Map<XmlElement, XmlElement[]>()
  private readonly byRun = new Map<XmlElement, XmlElement[]>()
  private readonly byParagraph = new Map<XmlElement, XmlElement[]>()
  private readonly nearestRun = new Map<XmlElement, XmlElement | undefined>()
  private readonly nearestParagraph = new Map<
    XmlElement,
    XmlElement | undefined
  >()
  private readonly trackedAncestor = new Set<XmlElement>()
  private readonly insideFallback = new Set<XmlElement>()
  private readonly trackedSubtree = new Set<XmlElement>()

  constructor(private readonly elements: readonly XmlElement[]) {
    for (const element of elements) {
      const parent = element.parent
      if (parent !== undefined) {
        const siblings = this.children.get(parent)
        if (siblings) siblings.push(element)
        else this.children.set(parent, [element])
        if (isTrackedChange(parent) || this.trackedAncestor.has(parent)) {
          this.trackedAncestor.add(element)
        }
        if (
          parent.localName === 'Fallback' ||
          this.insideFallback.has(parent)
        ) {
          this.insideFallback.add(element)
        }
      }
      const run =
        parent === undefined
          ? undefined
          : isWord(parent, 'r')
            ? parent
            : this.nearestRun.get(parent)
      this.nearestRun.set(element, run)
      this.bucket(this.byRun, run, element)
      const paragraph =
        parent === undefined
          ? undefined
          : isWord(parent, 'p')
            ? parent
            : this.nearestParagraph.get(parent)
      this.nearestParagraph.set(element, paragraph)
      this.bucket(this.byParagraph, paragraph, element)
    }
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index]
      if (isTrackedChange(element)) {
        this.trackedSubtree.add(element)
        continue
      }
      for (const child of this.children.get(element) ?? NO_ELEMENTS) {
        if (this.trackedSubtree.has(child)) {
          this.trackedSubtree.add(element)
          break
        }
      }
    }
  }

  root() {
    return this.elements.find(({ depth }) => depth === 0)
  }

  childrenOf(element: XmlElement) {
    return this.children.get(element) ?? NO_ELEMENTS
  }

  /** Elements whose nearest enclosing `w:r` is `run`, in document order. */
  descendantsOfRun(run: XmlElement) {
    return this.byRun.get(run) ?? NO_ELEMENTS
  }

  /** Elements whose nearest enclosing `w:p` is `paragraph`. */
  descendantsOfParagraph(paragraph: XmlElement) {
    return this.byParagraph.get(paragraph) ?? NO_ELEMENTS
  }

  inTrackedChange(element: XmlElement) {
    return this.trackedAncestor.has(element)
  }

  isInsideFallback(element: XmlElement) {
    return this.insideFallback.has(element)
  }

  /** The element itself or a descendant is a tracked change. */
  containsTrackedChange(element: XmlElement) {
    return this.trackedSubtree.has(element)
  }

  /** A `w:del` on the paragraph's own mark, which deletes the paragraph. */
  hasDeletedParagraphMark(paragraph: XmlElement) {
    const properties = this.childrenOf(paragraph).find((element) =>
      isWord(element, 'pPr'),
    )
    if (!properties) return false
    const mark = this.childrenOf(properties).find((element) =>
      isWord(element, 'rPr'),
    )
    if (!mark) return false
    return this.childrenOf(mark).some((element) => isWord(element, 'del'))
  }

  private bucket(
    into: Map<XmlElement, XmlElement[]>,
    key: XmlElement | undefined,
    element: XmlElement,
  ) {
    if (key === undefined) return
    const entries = into.get(key)
    if (entries) entries.push(element)
    else into.set(key, [element])
  }
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
  const trackedChanges = elements
    .filter(isTrackedChange)
    .filter((element) => !index.inTrackedChange(element))
    .map((element) =>
      trackedChange(
        partName,
        source,
        elements,
        element,
        paragraphAnchors,
        identity.nextChangeId(),
        moveRanges,
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
        !spanNestedInField(spans, span) &&
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
  const textElements = index
    .descendantsOfRun(runElement)
    .filter(
      (element) =>
        isWord(element, 't') &&
        !index.inTrackedChange(element) &&
        !index.isInsideFallback(element),
    )
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
  const textBreaks = index
    .childrenOf(runElement)
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
    text: runPlainText(source, index, runElement, textElements),
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
  return {
    wire,
    anchor: {
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
    },
  }
}

/**
 * A run nested in a stored `w:hyperlink` carries the relationship's target,
 * resolved on the part that owns the story — an `r:id` means nothing outside
 * its own `.rels` part. Internal links (`w:anchor`, no `r:id`) carry none.
 * A stored target gets the write path's scheme allowlist and length bound at
 * this point: one a hostile package plants (`javascript:`, an unbounded
 * string) is never set on the wire, so no consumer can render it as an
 * address while the part bytes stay untouched.
 */
function runHyperlinkTarget(
  runElement: XmlElement,
  hyperlinkTargets: ReadonlyMap<string, string> | undefined,
) {
  const link = nearestWordAncestor(runElement, 'hyperlink')
  if (!link) return undefined
  const relationshipId = attributeValue(link, RELATIONSHIPS_NAMESPACE, 'id')
  const target = relationshipId
    ? hyperlinkTargets?.get(relationshipId)
    : undefined
  return target !== undefined &&
    documentEditHyperlinkTargetSchema.safeParse(target).success
    ? target
    : undefined
}

function runPlainText(
  source: string,
  index: PartIndex,
  runElement: XmlElement,
  textElements: readonly XmlElement[],
) {
  const textNodes = new Set(
    textElements.filter((element) => !element.selfClosing),
  )
  const parts: string[] = []
  for (const element of index.descendantsOfRun(runElement)) {
    if (index.inTrackedChange(element) || index.isInsideFallback(element)) {
      continue
    }
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
