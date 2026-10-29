import {
  attributeValue,
  childrenByParent,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { decodeXmlReferences } from './xml-lexemes'

export type StoredFieldSpan = {
  begin?: XmlElement
  end?: XmlElement
  simple?: XmlElement
  boundary: XmlElement[]
  instruction: string
  boundaryParagraphs: XmlElement[]
  boundaryUnanchored: boolean
  rangeParagraphs: XmlElement[]
  beginParagraph?: XmlElement
  endParagraph?: XmlElement
  separateInBeginParagraph: boolean
  interrupted: boolean
  endLeadsParagraph: boolean
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

function leadingMarkupOnly(
  source: string,
  childrenOf: (element: XmlElement) => readonly XmlElement[],
  container: XmlElement,
  bound: XmlElement,
  allowed: readonly string[],
) {
  let cursor = container.startTagEnd
  for (const element of windowOf(
    childrenOf(container),
    container.startTagEnd,
    bound.start,
  )) {
    if (source.slice(cursor, element.start).trim().length > 0) return false
    if (!allowed.some((name) => isWord(element, name))) return false
    cursor = element.end
  }
  return source.slice(cursor, bound.start).trim().length === 0
}

function firstAtOrAfter(ordered: readonly XmlElement[], position: number) {
  let low = 0
  let high = ordered.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ordered[middle].start < position) low = middle + 1
    else high = middle
  }
  return low
}

function windowOf(
  ordered: readonly XmlElement[],
  from: number,
  to: number | undefined,
) {
  const window: XmlElement[] = []
  for (
    let index = firstAtOrAfter(ordered, from);
    index < ordered.length;
    index += 1
  ) {
    const element = ordered[index]
    if (to !== undefined && element.start >= to) break
    window.push(element)
  }
  return window
}

export function fieldSpans(
  elements: readonly XmlElement[],
  source: string,
): StoredFieldSpan[] {
  const spans: StoredFieldSpan[] = []
  const open: OpenField[] = []
  const children = childrenByParent(elements)
  const childrenOf = (element: XmlElement) => children.get(element) ?? []

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
    for (const element of windowOf(
      childrenOf(parent),
      beginParagraph.end,
      end.start,
    )) {
      if (!isWord(element, 'p') && !isWord(element, 'sectPr')) return true
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
      leadingMarkupOnly(source, childrenOf, endParagraph, endRun, [
        'pPr',
        'bookmarkStart',
        'bookmarkEnd',
      ]) && leadingMarkupOnly(source, childrenOf, endRun, end, ['rPr'])
    )
  }

  const firstBeginInParagraph = (
    begin: XmlElement,
    beginParagraph: XmlElement | undefined,
  ) => {
    if (beginParagraph === undefined) return false
    for (const element of windowOf(
      elements,
      beginParagraph.startTagEnd,
      beginParagraph.endTagStart,
    )) {
      if (
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
        : windowOf(
            beginParagraph.parent === undefined
              ? [beginParagraph]
              : childrenOf(beginParagraph.parent),
            beginParagraph.start,
            frame.end === undefined ? undefined : frame.end.start + 1,
          ).filter((element) => isWord(element, 'p'))
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

export function spanRangeReplaceable(span: StoredFieldSpan) {
  return (
    span.end !== undefined &&
    span.firstBeginInParagraph &&
    span.separateInBeginParagraph &&
    span.endLeadsParagraph &&
    !span.interrupted
  )
}

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

export function nestedFieldSpans(
  spans: readonly StoredFieldSpan[],
): ReadonlySet<StoredFieldSpan> {
  const edges: { span: StoredFieldSpan; begin: number; end?: number }[] = []
  for (const span of spans) {
    if (span.begin === undefined) continue
    edges.push({ span, begin: span.begin.start, end: span.end?.start })
  }
  edges.sort((left, right) => left.begin - right.begin)
  const endless = Number.POSITIVE_INFINITY
  const prefixEnd: number[] = [Number.NEGATIVE_INFINITY]
  for (const edge of edges) {
    const previous = prefixEnd[prefixEnd.length - 1] ?? Number.NEGATIVE_INFINITY
    const end = edge.end ?? endless
    prefixEnd.push(end > previous ? end : previous)
  }
  const nested = new Set<StoredFieldSpan>()
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]
    if (edge === undefined || edge.end === undefined) continue
    let low = 0
    let high = index
    while (low < high) {
      const middle = (low + high) >> 1
      const other = edges[middle]
      if (other !== undefined && other.begin < edge.begin) low = middle + 1
      else high = middle
    }
    const furthest = prefixEnd[low] ?? Number.NEGATIVE_INFINITY
    if (furthest > edge.end) nested.add(edge.span)
  }
  return nested
}

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
