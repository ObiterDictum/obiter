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
import { refuseShareSafe } from './share-safe-refusal'

/**
 * The word-family halves of the content analysis: comment-marker run
 * collapse, field-span classification and bookmark renaming. Each records
 * its decisions on the shared content plan the emitter and verifier replay.
 */
/**
 * A `w:commentReference` run that carried nothing else collapses — the
 * marker is gone, and a run holding only the marker and its formatting
 * leaves a dead shell.
 */
export function collapseCommentRuns(
  source: string,
  elements: readonly XmlElement[],
  contentPlan: ShareSafeContentPlan,
) {
  // Every run's fate is decided from the removal state the element pass
  // left, so the carries flag is computed once. Collapsing adds only `w:r`
  // elements to `removed`, and a run that reaches the collapse decision
  // below has no non-rPr descendant — runs can nest, since a text box holds
  // one — so no later collapse can sit inside it and change what it
  // excludes.
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
  for (const element of elements) {
    if (!isWord(element, 'commentReference')) continue
    const run = nearestRun(element)
    if (!run || contentPlan.removed.has(run) || carries.has(run)) continue
    // One run can carry many comment references, and a run that keeps text
    // is never collapsed: decide each run once, or the same run is examined
    // per marker.
    if (decided.has(run)) continue
    decided.add(run)
    const text = innerTextExcluding(source, run, removedByStart)
    if (text.trim() === '') contentPlan.removed.add(run)
  }
}

function nearestRun(element: XmlElement) {
  let cursor = element.parent
  while (cursor) {
    if (isWord(cursor, 'r')) return cursor
    cursor = cursor.parent
  }
  return undefined
}

/**
 * The text a consumer reads inside `element`, minus every removed
 * descendant's range — used only to decide whether an emptied run still
 * carries anything.
 */
function innerTextExcluding(
  source: string,
  element: XmlElement,
  removedByStart: readonly XmlElement[],
) {
  // `removedByStart` is sorted once by the caller: binary-search to the
  // first removed element inside this element's content range, then walk
  // only that window. Filtering the whole removed set per candidate run is
  // quadratic in a comment-heavy part.
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

/**
 * Field machinery: spans are reconstructed semantically, classified by
 * instruction name, and marked for the emitter — remove-class fields drop
 * their whole span, flatten-class fields keep only their displayed result,
 * and orphaned markers go. A span the element pass half-removed closes
 * over the whole span: a partial field never ships.
 */
export function analyseWordFields(
  part: SourcePart,
  source: string,
  elements: readonly XmlElement[],
  gone: (element: XmlElement) => boolean,
  bookmarkRenames: ReadonlyMap<string, string>,
  contentPlan: ShareSafeContentPlan,
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
    // Keep-class spans ship their instruction — but only reference fields
    // rewrite operands, and only to bookmark names that actually ship. A
    // dangling operand flattens the field to its displayed result.
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
  // A span the element pass half-removed closes over its whole span, and
  // that closure propagates between spans that share elements. Propagate it
  // with a worklist instead of rescanning every span to a fixpoint, which is
  // quadratic when a part is built from many nested fields.
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
  const triggerable = (span: FieldSpan) =>
    (triggerElements.get(span) ?? []).some((element) =>
      contentPlan.removed.has(element),
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

/**
 * Flattening drops a field's machinery — the `w:fldChar` markers and
 * instruction runs — while its displayed result stays: a complex field
 * loses `[begin, lastSeparate)` plus the end marker, and a `w:fldSimple`
 * loses only its wrapper (and with it the `w:instr` attribute).
 */
function flattenField(span: FieldSpan, contentPlan: ShareSafeContentPlan) {
  if (span.simple !== undefined) {
    contentPlan.unwrapped.add(span.simple)
    return
  }
  for (const element of span.dropped) contentPlan.removed.add(element)
}

/**
 * Every name a bookmark or form field carries is replaced by a generated
 * `bm<n>` — the input names are labels a recipient can read, so none
 * ships. `w:anchor` values that name a renamed bookmark are rewritten to
 * the generated name; an anchor that names nothing emitted is dropped.
 * Field instructions are rewritten token-wise so `REF`/`PAGEREF` argument
 * names follow the same map.
 */
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
