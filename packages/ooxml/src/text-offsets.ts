import {
  OoxmlError,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { decodeXmlReferences } from './xml-lexemes'

/**
 * The shared owner for resolving a model text offset to a position in a
 * part's source XML. Comment markers, emphasis cuts, hyperlinks, page breaks,
 * table-of-contents and section splices all place boundaries by the same
 * rule: a paragraph's wire text is the concatenation of its runs' editable
 * text nodes, and a boundary inside a run lands at the decoded-text
 * position the node reports. Splitting this module out of comment-anchors
 * keeps one traversal owner so no caller can disagree about a break or an
 * entity boundary.
 */
export type RunSplitPoint = {
  kind: 'run'
  run: TextRunAnchor
  textElement?: XmlElementRange
  position: 'content' | 'before-element' | 'after-element'
}
export type EmptyParagraphSplitPoint = {
  kind: 'empty-paragraph'
  paragraph: XmlElementRange
}
export type SplitPoint = RunSplitPoint | EmptyParagraphSplitPoint
export type InsertionPoint = {
  sourceOffset: number
  split?: SplitPoint
}

/**
 * `afterBoundaryContent` chooses which side of a text-element boundary an
 * interior offset resolves to. Boundary-hugging callers — comment markers,
 * emphasis cuts, page breaks — keep the default `after-element` answer (the
 * preceding element's close). Splice insertions pass `true` so the point is
 * the next editable element's start, after any non-editable siblings the
 * batch already placed at that effective offset: the wire model lands
 * repeated inserts at one offset in operation order (it skips zero-length
 * runs), and the source splice must order identically.
 */
export function locateOffset(
  source: string,
  paragraph: ParagraphAnchor,
  offset: number,
  afterBoundaryContent = false,
): InsertionPoint {
  const totalLength = paragraph.runs.reduce(
    (length, run) => length + run.wire.text.length,
    0,
  )
  if (offset === totalLength) {
    const { paragraphRange } = paragraph
    if (
      totalLength === 0 &&
      paragraphRange.startTagEnd === paragraphRange.endTagStart &&
      paragraphRange.startTagEnd === paragraphRange.end
    ) {
      return {
        sourceOffset: paragraphRange.start,
        split: { kind: 'empty-paragraph', paragraph: paragraphRange },
      }
    }
    return { sourceOffset: paragraphRange.endTagStart }
  }

  let runStart = 0
  for (const run of paragraph.runs) {
    const runEnd = runStart + run.wire.text.length
    if (run.wire.text.length > 0 && offset === runStart) {
      return { sourceOffset: run.runRange.start }
    }
    if (offset > runStart && offset < runEnd) {
      return locateInsideRun(
        source,
        run,
        offset - runStart,
        afterBoundaryContent,
      )
    }
    runStart = runEnd
  }
  throw new OoxmlError('comment-anchor-unresolved')
}

// The run's editable text as source-order nodes. A `w:t` contributes its
// decoded text; a text-wrapping `w:br` contributes exactly one `\n`, matching
// the parser's `runPlainText` and `DocumentTextRunWire.text`. Everything else
// in a run is structure and contributes no offset.
export type EditableTextNode = { range: XmlElementRange; textBreak: boolean }

export function editableTextNodes(run: TextRunAnchor): EditableTextNode[] {
  return [
    ...run.textElements.map((range) => ({ range, textBreak: false })),
    ...run.textBreaks.map((range) => ({ range, textBreak: true })),
  ].sort((left, right) => left.range.start - right.range.start)
}

function locateInsideRun(
  source: string,
  run: TextRunAnchor,
  localOffset: number,
  afterBoundaryContent: boolean,
): InsertionPoint {
  const nodes = editableTextNodes(run).map((node) => ({
    ...node,
    raw: node.textBreak
      ? ''
      : source.slice(node.range.startTagEnd, node.range.endTagStart),
  }))
  const decoded = nodes.map((node) => ({
    ...node,
    text: node.textBreak ? '\n' : decodeXmlReferences(node.raw),
  }))
  // A run whose anchors do not reconstruct its model text, such as a break the
  // parser counted but did not anchor, cannot be split faithfully. Refuse
  // rather than place a boundary by guesswork.
  if (decoded.map((node) => node.text).join('') !== run.wire.text) {
    throw new OoxmlError('comment-anchor-unresolved')
  }

  let textStart = 0
  for (const node of decoded) {
    const textEnd = textStart + node.text.length
    if (localOffset === textStart) {
      return {
        sourceOffset: node.range.start,
        split: {
          kind: 'run',
          run,
          textElement: node.range,
          position: 'before-element',
        },
      }
    }
    if (!node.textBreak && localOffset > textStart && localOffset < textEnd) {
      return {
        sourceOffset:
          node.range.startTagEnd +
          rawOffsetAtDecodedBoundary(node.raw, localOffset - textStart),
        split: {
          kind: 'run',
          run,
          textElement: node.range,
          position: 'content',
        },
      }
    }
    if (localOffset === textEnd && !afterBoundaryContent) {
      return {
        sourceOffset: node.range.end,
        split: {
          kind: 'run',
          run,
          textElement: node.range,
          position: 'after-element',
        },
      }
    }
    textStart = textEnd
  }
  throw new OoxmlError('comment-anchor-unresolved')
}

function rawOffsetAtDecodedBoundary(raw: string, boundary: number) {
  let rawOffset = 0
  let decodedOffset = 0
  while (decodedOffset < boundary) {
    if (raw[rawOffset] === '&') {
      const end = raw.indexOf(';', rawOffset + 1)
      if (end === -1) throw new OoxmlError('comment-anchor-unresolved')
      const decoded = decodeXmlReferences(raw.slice(rawOffset, end + 1))
      if (decodedOffset + decoded.length > boundary) {
        throw new OoxmlError('comment-anchor-unresolved')
      }
      decodedOffset += decoded.length
      rawOffset = end + 1
    } else {
      decodedOffset += 1
      rawOffset += 1
    }
  }
  return rawOffset
}

export function preserveTextOpeningTag(opening: string) {
  const xmlSpace = /\s+xml:space\s*=\s*(["'])[^"']*\1/u
  if (xmlSpace.test(opening)) {
    return opening.replace(xmlSpace, ' xml:space="preserve"')
  }
  return opening.replace(/>$/u, ' xml:space="preserve">')
}
