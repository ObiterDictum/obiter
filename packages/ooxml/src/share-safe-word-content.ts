import {
  isDescendantOf,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import type { SourcePart } from './model'
import { xmlInnerText } from './xml-lexemes'
import type { ShareSafeContentPlan } from './share-safe-parts'
import {
  analyseFieldSpans,
  classifyFieldInstruction,
  FIELD_REFERENCE_NAMES,
  rewriteReferenceInstruction,
  type FieldSpan,
} from './share-safe-fields'
import { fieldInstructionName } from './field-instructions'
import { SHARE_SAFE_COMMENT_MARKERS } from './share-safe-word-classes'
import { refuseShareSafe } from './share-safe-refusal'

export function collapseCommentRuns(
  source: string,
  elements: readonly XmlElement[],
  contentPlan: ShareSafeContentPlan,
): Set<XmlElement> {
  const removedByStart = [...contentPlan.removed].sort(
    (left, right) => left.start - right.start,
  )
  const runProperties = new Map<XmlElement, XmlElement>()
  for (const element of elements) {
    if (
      isWord(element, 'rPr') &&
      element.parent !== undefined &&
      isWord(element.parent, 'r')
    ) {
      runProperties.set(element.parent, element)
    }
  }
  const carries = new Set<XmlElement>()
  for (const element of elements) {
    if (contentPlan.removed.has(element) || isWord(element, 'rPr')) continue
    const run = nearestRun(element)
    if (run === undefined || contentPlan.removed.has(run)) continue
    const properties = runProperties.get(run)
    if (properties !== undefined && isDescendantOf(element, properties)) {
      continue
    }
    carries.add(run)
  }
  const decided = new Set<XmlElement>()
  const collapsed = new Set<XmlElement>()
  for (const element of elements) {
    if (
      element.namespaceUri !== WORD_NAMESPACE ||
      !SHARE_SAFE_COMMENT_MARKERS.has(element.localName)
    ) {
      continue
    }
    const run = nearestRun(element)
    if (!run || contentPlan.removed.has(run) || carries.has(run)) continue
    if (decided.has(run)) continue
    decided.add(run)
    const text = innerTextExcluding(source, run, removedByStart)
    if (text.trim() === '') {
      contentPlan.removed.add(run)
      collapsed.add(run)
    }
  }
  return collapsed
}

function nearestRun(element: XmlElement) {
  let cursor = element.parent
  while (cursor) {
    if (isWord(cursor, 'r')) return cursor
    cursor = cursor.parent
  }
  return undefined
}

function innerTextExcluding(
  source: string,
  element: XmlElement,
  removedByStart: readonly XmlElement[],
) {
  let low = 0
  let high = removedByStart.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (removedByStart[middle].start < element.startTagEnd) low = middle + 1
    else high = middle
  }
  const boundaries: XmlElement[] = []
  for (let index = low; index < removedByStart.length; index += 1) {
    const candidate = removedByStart[index]
    if (candidate.start > element.endTagStart) break
    if (
      candidate.end <= element.endTagStart &&
      isDescendantOf(candidate, element)
    ) {
      boundaries.push(candidate)
    }
  }
  let text = ''
  let cursor = element.startTagEnd
  for (const range of boundaries) {
    if (range.end <= cursor) continue
    text += xmlInnerText(
      source,
      cursor,
      Math.min(range.start, element.endTagStart),
    )
    cursor = Math.max(cursor, range.end)
  }
  text += xmlInnerText(source, cursor, element.endTagStart)
  return text
}

export function analyseWordFields(
  part: SourcePart,
  source: string,
  elements: readonly XmlElement[],
  gone: (element: XmlElement) => boolean,
  bookmarkRenames: ReadonlyMap<string, string>,
  contentPlan: ShareSafeContentPlan,
  collapsedCommentRuns: ReadonlySet<XmlElement>,
) {
  const fields = analyseFieldSpans(
    source,
    elements,
    (start, end) => xmlInnerText(source, start, end),
    gone,
  )
  if (fields.depthExceeded) {
    refuseShareSafe(
      'oversized-structure',
      `${part.name} nests fields past the share-safe cap`,
    )
  }
  if (fields.refused) {
    refuseShareSafe(
      'malformed-package',
      `a field in ${part.name} does not close`,
    )
  }
  for (const marker of fields.orphanMarkers) contentPlan.removed.add(marker)
  for (const span of fields.spans) {
    const classification = classifyFieldInstruction(span.instruction)
    if (classification === 'remove') {
      for (const element of span.whole) contentPlan.removed.add(element)
      continue
    }
    if (classification === 'flatten') {
      flattenField(span, contentPlan)
      continue
    }
    if (classification === 'refuse') {
      refuseShareSafe(
        'unsupported-structure',
        `${part.name} carries a field instruction ${fieldInstructionName(span.instruction) || '(unnamed)'} the copy cannot bound`,
      )
    }
    let rewritten: string | undefined
    if (FIELD_REFERENCE_NAMES.has(fieldInstructionName(span.instruction))) {
      const resolution = rewriteReferenceInstruction(
        span.instruction,
        bookmarkRenames,
      )
      if (resolution === 'flatten') {
        flattenField(span, contentPlan)
        continue
      }
      rewritten = resolution
    }
    if (rewritten === undefined) continue
    if (span.simple !== undefined) {
      const attribute = span.simple.attributes.find(
        (candidate) =>
          candidate.namespaceUri === WORD_NAMESPACE &&
          candidate.localName === 'instr',
      )
      if (attribute !== undefined) {
        contentPlan.attrOverrides.set(attribute, rewritten)
      }
      continue
    }
    const [first, ...rest] = span.instrText
    if (first === undefined) continue
    contentPlan.textOverrides.set(first, rewritten)
    for (const element of rest) contentPlan.textOverrides.set(element, '')
  }
  const triggerElements = new Map<FieldSpan, XmlElement[]>()
  const spansByElement = new Map<XmlElement, FieldSpan[]>()
  for (const span of fields.spans) {
    const dropped = new Set(span.dropped)
    triggerElements.set(
      span,
      span.whole.filter((element) => !dropped.has(element)),
    )
    for (const element of span.whole) {
      const containing = spansByElement.get(element)
      if (containing) containing.push(span)
      else spansByElement.set(element, [span])
    }
  }
  const isCommentSurface = (element: XmlElement) =>
    collapsedCommentRuns.has(element) ||
    (element.namespaceUri === WORD_NAMESPACE &&
      SHARE_SAFE_COMMENT_MARKERS.has(element.localName))
  const triggerable = (span: FieldSpan) =>
    (triggerElements.get(span) ?? []).some(
      (element) =>
        contentPlan.removed.has(element) && !isCommentSurface(element),
    )
  const processed = new Set<FieldSpan>()
  const queue: FieldSpan[] = []
  const enqueueIfTriggerable = (span: FieldSpan) => {
    if (processed.has(span) || !triggerable(span)) return
    processed.add(span)
    queue.push(span)
  }
  for (const span of fields.spans) enqueueIfTriggerable(span)
  while (queue.length > 0) {
    const span = queue.pop()
    if (span === undefined) break
    for (const element of span.whole) {
      if (contentPlan.removed.has(element)) continue
      contentPlan.removed.add(element)
      for (const containing of spansByElement.get(element) ?? []) {
        enqueueIfTriggerable(containing)
      }
    }
  }
}

function flattenField(span: FieldSpan, contentPlan: ShareSafeContentPlan) {
  if (span.simple !== undefined) {
    contentPlan.unwrapped.add(span.simple)
    return
  }
  for (const element of span.dropped) contentPlan.removed.add(element)
}

export function rewriteBookmarks(
  part: SourcePart,
  elements: readonly XmlElement[],
  gone: (element: XmlElement) => boolean,
  renames: ReadonlyMap<string, string>,
  contentPlan: ShareSafeContentPlan,
) {
  for (const element of elements) {
    if (gone(element) || element.namespaceUri !== WORD_NAMESPACE) continue
    if (element.localName === 'bookmarkStart') {
      const name = element.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WORD_NAMESPACE &&
          attribute.localName === 'name',
      )
      const renamed = name && renames.get(name.value)
      if (
        name !== undefined &&
        renamed !== undefined &&
        renamed !== name.value
      ) {
        contentPlan.attrOverrides.set(name, renamed)
      }
      continue
    }
    if (element.localName === 'hyperlink') {
      const anchor = element.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WORD_NAMESPACE &&
          attribute.localName === 'anchor',
      )
      if (anchor === undefined) continue
      const renamed = renames.get(anchor.value)
      if (renamed !== anchor.value) {
        contentPlan.attrOverrides.set(anchor, renamed)
      }
      continue
    }
    if (
      element.localName === 'name' &&
      element.parent !== undefined &&
      isWord(element.parent, 'ffData')
    ) {
      const value = element.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WORD_NAMESPACE &&
          attribute.localName === 'val',
      )
      const renamed = value && renames.get(value.value)
      if (
        value !== undefined &&
        renamed !== undefined &&
        renamed !== value.value
      ) {
        contentPlan.attrOverrides.set(value, renamed)
      }
    }
  }
}
