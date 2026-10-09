import {
  attributeValue,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { decodeXmlReferences } from './xml-lexemes'

/**
 * One stored field paired from a part's element stream: a complex
 * `w:fldChar` field or a self-contained `w:fldSimple`. Three consumers read
 * this one scan — the model parser emitting `story.fields`, the update
 * writer proving the shape it can rewrite, and the batch validators
 * refusing a removal that leaves a field unbalanced — so the pairing rule
 * and the tail contract cannot drift between surfaces.
 *
 * `begin`/`end` are the field's own `fldChar` elements; a `separate`
 * belongs to the innermost open field, matching the order the elements
 * appear in source. A field that never closes keeps `end` undefined.
 */
export type StoredFieldSpan = {
  /** The `fldChar` begin — absent for a `w:fldSimple`. */
  begin?: XmlElement
  /** The `fldChar` end that closed the field — absent while it stays open. */
  end?: XmlElement
  /** The `w:fldSimple` element when the field is not a complex one. */
  simple?: XmlElement
  /**
   * The boundary elements attributed to this field alone, in source order:
   * its begin, its own `separate` markers and its `end` — never a nested
   * field's. Removing some but not all unbalances the stored field.
   */
  boundary: XmlElement[]
  /** The decoded instruction text — the `instrText` content the field
   * accumulated before its `separate`, or a `w:fldSimple`'s `w:instr`. */
  instruction: string
  /** The `w:p` ancestors of the boundary elements that sit inside one. */
  boundaryParagraphs: XmlElement[]
  /** True when a boundary marker sits outside every `w:p` — markup a
   * paragraph deletion can never address. */
  boundaryUnanchored: boolean
  /** The `w:p` siblings the field's range covers — the head paragraph
   * through the one holding `end`, or just the head while the field
   * stays open. */
  rangeParagraphs: XmlElement[]
  /** The `w:p` holding `begin` — or the `w:fldSimple`. */
  beginParagraph?: XmlElement
  /** The `w:p` holding `end`, when it sits inside one. */
  endParagraph?: XmlElement
  /** The field's own `separate` sits inside the `begin` paragraph — the
   * result boundary an in-place refresh needs the head to hold. */
  separateInBeginParagraph: boolean
  /**
   * A `w:p` sibling of the head paragraph is not the only thing between
   * the head and the `end`: a `w:tbl`, a block-level `w:sdt` or any other
   * same-level element sits inside the field's range, so nothing defined
   * by paragraph spans describes it.
   */
  interrupted: boolean
  /**
   * The tail shape a range rewrite needs: the `end` sits in a different
   * paragraph than the `begin`, inside a run that is a direct child of
   * that paragraph, led only by markup (`pPr`, bookmarks; `rPr` inside the
   * run) — the run the rewrite keeps while replacing everything before it.
   */
  endLeadsParagraph: boolean
  /** The field's `begin` is its paragraph's first `fldChar` begin — an
   * update addressed at the head rewrites from that character, so an
   * earlier field in the same paragraph disqualifies it. */
  firstBeginInParagraph: boolean
}

type OpenField = {
  begin: XmlElement
  boundary: XmlElement[]
  instruction: string
  separated: boolean
  separateInBeginParagraph: boolean
}

const FIELD_CHAR_BEGIN = 'begin'
const FIELD_CHAR_SEPARATE = 'separate'
const FIELD_CHAR_END = 'end'

function fieldCharType(element: XmlElement) {
  return attributeValue(element, WORD_NAMESPACE, 'fldCharType')
}

/**
 * The container's children before `bound` are only `allowed` elements
 * separated by whitespace — no text or unexpected markup — read from the
 * parsed element tree so attribute order or an added `w:rPr` cannot fool a
 * regex.
 */
function leadingMarkupOnly(
  source: string,
  elements: readonly XmlElement[],
  container: XmlElement,
  bound: XmlElement,
  allowed: readonly string[],
) {
  let cursor = container.startTagEnd
  for (const element of elements) {
    if (element.parent !== container) continue
    if (element.start >= bound.start) break
    if (source.slice(cursor, element.start).trim().length > 0) return false
    if (!allowed.some((name) => isWord(element, name))) return false
    cursor = element.end
  }
  return source.slice(cursor, bound.start).trim().length === 0
}

/**
 * Pairs every field in one part's element stream. Complex fields stack —
 * a `PAGEREF` inside a `TOA` result is its own span, closed by its own
 * `end` — and an element order walk is the only pairing the serialised
 * markup supports. A field still open at the part's end is emitted with
 * `end` undefined so a consumer sees it rather than the field vanishing.
 */
export function fieldSpans(
  elements: readonly XmlElement[],
  source: string,
): StoredFieldSpan[] {
  const spans: StoredFieldSpan[] = []
  const open: OpenField[] = []

  const paragraphsOf = (frame: {
    begin?: XmlElement
    simple?: XmlElement
    boundary: XmlElement[]
    end?: XmlElement
  }) => {
    const boundaryParagraphs: XmlElement[] = []
    let boundaryUnanchored = false
    for (const marker of frame.boundary) {
      const paragraph = nearestWordAncestor(marker, 'p')
      if (paragraph === undefined) {
        boundaryUnanchored = true
        continue
      }
      if (!boundaryParagraphs.includes(paragraph)) {
        boundaryParagraphs.push(paragraph)
      }
    }
    const anchor = frame.begin ?? frame.simple
    const beginParagraph = anchor ? nearestWordAncestor(anchor, 'p') : undefined
    const endParagraph = frame.end
      ? nearestWordAncestor(frame.end, 'p')
      : undefined
    return {
      boundaryParagraphs,
      boundaryUnanchored,
      beginParagraph,
      endParagraph,
    }
  }

  const interrupted = (beginParagraph: XmlElement, end: XmlElement) => {
    const parent = beginParagraph.parent
    if (parent === undefined) return true
    for (const element of elements) {
      if (element.end <= beginParagraph.end) continue
      if (element.start >= end.start) break
      if (
        element.parent === parent &&
        !isWord(element, 'p') &&
        !isWord(element, 'sectPr')
      ) {
        return true
      }
    }
    return false
  }

  const endLeadsParagraph = (
    endParagraph: XmlElement,
    beginParagraph: XmlElement | undefined,
    end: XmlElement,
  ) => {
    if (beginParagraph === undefined || endParagraph === beginParagraph) {
      return false
    }
    const endRun = end.parent
    if (endRun === undefined || !isWord(endRun, 'r')) return false
    if (endRun.parent !== endParagraph) return false
    return (
      leadingMarkupOnly(source, elements, endParagraph, endRun, [
        'pPr',
        'bookmarkStart',
        'bookmarkEnd',
      ]) && leadingMarkupOnly(source, elements, endRun, end, ['rPr'])
    )
  }

  const firstBeginInParagraph = (
    begin: XmlElement,
    beginParagraph: XmlElement | undefined,
  ) => {
    if (beginParagraph === undefined) return false
    for (const element of elements) {
      if (element.end <= beginParagraph.startTagEnd) continue
      if (element.start >= beginParagraph.endTagStart) break
      if (
        element.start >= beginParagraph.startTagEnd &&
        isWord(element, 'fldChar') &&
        fieldCharType(element) === FIELD_CHAR_BEGIN
      ) {
        return element === begin
      }
    }
    return true
  }

  const emit = (frame: {
    begin?: XmlElement
    end?: XmlElement
    simple?: XmlElement
    boundary: XmlElement[]
    instruction: string
    separateInBeginParagraph: boolean
  }) => {
    const {
      boundaryParagraphs,
      boundaryUnanchored,
      beginParagraph,
      endParagraph,
    } = paragraphsOf(frame)
    const rangeParagraphs =
      beginParagraph === undefined
        ? []
        : elements.filter(
            (element) =>
              isWord(element, 'p') &&
              element.parent === beginParagraph.parent &&
              element.start >= beginParagraph.start &&
              (frame.end === undefined || element.start <= frame.end.start),
          )
    spans.push({
      ...frame,
      boundaryParagraphs,
      boundaryUnanchored,
      rangeParagraphs,
      beginParagraph,
      endParagraph,
      interrupted:
        beginParagraph !== undefined && frame.end !== undefined
          ? interrupted(beginParagraph, frame.end)
          : false,
      endLeadsParagraph:
        frame.end !== undefined && endParagraph !== undefined
          ? endLeadsParagraph(endParagraph, beginParagraph, frame.end)
          : false,
      firstBeginInParagraph:
        frame.begin !== undefined
          ? firstBeginInParagraph(frame.begin, beginParagraph)
          : true,
    })
  }

  for (const element of elements) {
    if (isWord(element, 'fldSimple')) {
      const instruction =
        element.attributes.find(
          (attribute) =>
            attribute.localName === 'instr' &&
            attribute.namespaceUri === WORD_NAMESPACE,
        )?.value ?? ''
      emit({
        simple: element,
        boundary: [element],
        instruction,
        separateInBeginParagraph: false,
      })
      continue
    }
    if (isWord(element, 'instrText')) {
      const top = open.at(-1)
      if (top && !top.separated) {
        top.instruction += decodeXmlReferences(
          element.selfClosing
            ? ''
            : source.slice(element.startTagEnd, element.endTagStart),
        )
      }
      continue
    }
    if (!isWord(element, 'fldChar')) continue
    const type = fieldCharType(element)
    if (type === FIELD_CHAR_BEGIN) {
      open.push({
        begin: element,
        boundary: [element],
        instruction: '',
        separated: false,
        separateInBeginParagraph: false,
      })
      continue
    }
    const top = open.at(-1)
    if (top === undefined) continue
    top.boundary.push(element)
    if (type === FIELD_CHAR_SEPARATE) {
      top.separated = true
      if (
        nearestWordAncestor(element, 'p') ===
        nearestWordAncestor(top.begin, 'p')
      ) {
        top.separateInBeginParagraph = true
      }
      continue
    }
    if (type === FIELD_CHAR_END) {
      open.pop()
      emit({
        begin: top.begin,
        end: element,
        boundary: top.boundary,
        instruction: top.instruction,
        separateInBeginParagraph: top.separateInBeginParagraph,
      })
    }
  }
  for (const leftover of open) {
    emit({
      begin: leftover.begin,
      boundary: leftover.boundary,
      instruction: leftover.instruction,
      separateInBeginParagraph: leftover.separateInBeginParagraph,
    })
  }
  return spans
}

/**
 * Whether the field's stored shape proves the range rewrite an in-place
 * refresh performs: it closes, its `begin` leads its paragraph's fields, a
 * `separate` sits in the head, the `end` leads a different tail paragraph,
 * and no non-paragraph sibling interrupts the range.
 */
export function spanRangeReplaceable(span: StoredFieldSpan) {
  return (
    span.end !== undefined &&
    span.firstBeginInParagraph &&
    span.separateInBeginParagraph &&
    span.endLeadsParagraph &&
    !span.interrupted
  )
}

/**
 * Whether another field in the same part encloses this one. Rewriting an
 * inner field's range drops its `begin` while the outer field's `end`
 * survives past the tail — the outer field is left unbalanced — so a
 * nested field is never range-replaceable.
 */
export function spanNestedInField(
  spans: readonly StoredFieldSpan[],
  span: StoredFieldSpan,
) {
  const begin = span.begin
  const end = span.end
  if (begin === undefined || end === undefined) return false
  return spans.some(
    (other) =>
      other !== span &&
      other.begin !== undefined &&
      other.begin.start < begin.start &&
      (other.end === undefined || other.end.start > end.start),
  )
}

/**
 * Whether removing `ranges` splits a stored field: some but not all of one
 * field's boundary markers fall inside a removed range. A field removed
 * whole — every marker covered — stays balanced and is allowed; a partial
 * removal leaves stray `fldChar`s Word can never pair.
 */
export function fieldBoundarySplit(
  elements: readonly XmlElement[],
  source: string,
  ranges: readonly { start: number; end: number }[],
) {
  if (ranges.length === 0) return false
  for (const span of fieldSpans(elements, source)) {
    const covered = span.boundary.filter((marker) =>
      ranges.some(
        (range) => marker.start >= range.start && marker.end <= range.end,
      ),
    )
    if (covered.length > 0 && covered.length < span.boundary.length) {
      return true
    }
  }
  return false
}
