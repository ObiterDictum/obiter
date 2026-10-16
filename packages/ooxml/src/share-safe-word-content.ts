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
  for (const element of elements) {
    if (!isWord(element, 'commentReference')) continue
    const run = nearestRun(element)
    if (!run || contentPlan.removed.has(run)) continue
    const carries = elements.some(
      (candidate) =>
        !contentPlan.removed.has(candidate) &&
        isDescendantOf(candidate, run) &&
        !isWord(candidate, 'rPr') &&
        !isInsideRunProperties(elements, candidate, run),
    )
    if (carries) continue
    const text = innerTextExcluding(source, run, contentPlan.removed)
    if (text.trim() === '') contentPlan.removed.add(run)
  }
}

function isInsideRunProperties(
  elements: readonly XmlElement[],
  element: XmlElement,
  run: XmlElement,
) {
  const properties = elements.find(
    (candidate) => candidate.parent === run && isWord(candidate, 'rPr'),
  )
  return properties !== undefined && isDescendantOf(element, properties)
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
  removed: ReadonlySet<XmlElement>,
) {
  const boundaries = [...removed]
    .filter(
      (candidate) =>
        isDescendantOf(candidate, element) &&
        candidate.start >= element.startTagEnd &&
        candidate.end <= element.endTagStart,
    )
    .sort((left, right) => left.start - right.start)
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
  let changed = true
  while (changed) {
    changed = false
    for (const span of fields.spans) {
      const keptBySpan = span.whole.filter(
        (element) => !span.dropped.includes(element),
      )
      if (!keptBySpan.some((element) => contentPlan.removed.has(element))) {
        continue
      }
      for (const element of span.whole) {
        if (!contentPlan.removed.has(element)) {
          contentPlan.removed.add(element)
          changed = true
        }
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
