import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentModelWire,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { decodeXmlReferences } from './xml-lexemes'
import { setOverlayReplacement } from './parts/overlay'

export type AllocatedReply = {
  /** The product-authored reply as it will be emitted into the package. */
  reply: { author: { name: string }; createdAt: string; body: string }
  ooxmlId: number
  /** The `w14:paraId` this reply's own comment paragraph carries. */
  paraId: string | null
}

export type AllocatedComment = {
  comment: DocumentComment
  ooxmlId: number
  /**
   * The `w14:paraId` on the emitted comment's paragraph — present whenever
   * `commentsExtended` metadata (threading or done state) must name it.
   */
  paraId: string | null
  replies: AllocatedReply[]
}

type MarkerKind = 'start' | 'end' | 'reference'
type Marker = {
  kind: MarkerKind
  ooxmlId: number
  zeroLength: boolean
}
type RunSplitPoint = {
  kind: 'run'
  run: TextRunAnchor
  textElement?: XmlElementRange
  position: 'content' | 'before-element' | 'after-element'
}
type EmptyParagraphSplitPoint = {
  kind: 'empty-paragraph'
  paragraph: XmlElementRange
}
type SplitPoint = RunSplitPoint | EmptyParagraphSplitPoint
export type InsertionPoint = {
  sourceOffset: number
  split?: SplitPoint
}
type PendingInsertion = InsertionPoint & { markers: Marker[] }

export function placeCommentAnchors(
  document: OoxmlDocument,
  comments: readonly AllocatedComment[],
) {
  const insertionsByPart = new Map<string, Map<number, PendingInsertion>>()

  for (const allocated of comments) {
    const anchor = allocated.comment.anchor
    const { start, end } = resolveParagraphs(document, allocated.comment)
    // The three markers collapse onto one source point only for a zero-length
    // range inside a single paragraph; for any other shape the start and end
    // markers sit at different positions or in different paragraphs.
    const zeroLength = start === end && anchor.startOffset === anchor.endOffset
    addMarker(document, insertionsByPart, start, anchor.startOffset, {
      kind: 'start',
      ooxmlId: allocated.ooxmlId,
      zeroLength,
    })
    addMarker(document, insertionsByPart, end, anchor.endOffset, {
      kind: 'end',
      ooxmlId: allocated.ooxmlId,
      zeroLength,
    })
    addMarker(document, insertionsByPart, end, anchor.endOffset, {
      kind: 'reference',
      ooxmlId: allocated.ooxmlId,
      zeroLength,
    })
  }

  for (const [partName, insertions] of insertionsByPart) {
    const part = document.sourceParts.get(partName)
    if (!part?.overlay || part.kind !== 'xml' || part.dirty) {
      throw new OoxmlError('comment-anchor-unresolved')
    }
    const rewrittenTextElements = new Set<number>()
    const orderedInsertions = [...insertions.values()].sort(
      (left, right) => left.sourceOffset - right.sourceOffset,
    )
    for (const insertion of orderedInsertions) {
      const textElementStart =
        insertion.split?.kind === 'run' &&
        insertion.split.position === 'content'
          ? insertion.split.textElement?.start
          : undefined
      const rewriteFirstHalf =
        textElementStart !== undefined &&
        !rewrittenTextElements.has(textElementStart)
      if (rewriteFirstHalf) rewrittenTextElements.add(textElementStart)
      setOverlayReplacement(
        part.overlay,
        `comment-anchor:${insertion.sourceOffset}`,
        insertionXml(part.overlay.source, insertion, rewriteFirstHalf),
      )
    }
    part.dirty = true
  }
}

/**
 * Validates an anchor against the model: both endpoint paragraphs must be
 * unique, must live in the same story, and must be ordered start before end.
 * Returns the two endpoint wire paragraphs — the same object twice for a
 * single-paragraph range or an insertion point.
 */
export function validateCommentAnchor(
  model: DocumentModelWire,
  anchor: DocumentCommentAnchor,
) {
  const start = resolveWireParagraph(model, anchor.paragraphId)
  const end =
    anchor.endParagraphId === undefined ||
    anchor.endParagraphId === anchor.paragraphId
      ? start
      : resolveWireParagraph(model, anchor.endParagraphId)

  if (end.story !== start.story || start.index > end.index) {
    throw new OoxmlError('comment-anchor-unresolved')
  }

  const startText = wireParagraphText(start.paragraph)
  const endText = wireParagraphText(end.paragraph)
  if (start === end) {
    if (
      anchor.startOffset > anchor.endOffset ||
      anchor.endOffset > startText.length ||
      splitsSurrogate(startText, anchor.startOffset) ||
      splitsSurrogate(startText, anchor.endOffset)
    ) {
      throw new OoxmlError('comment-anchor-unresolved')
    }
    return { start: start.paragraph, end: end.paragraph }
  }

  if (
    anchor.startOffset > startText.length ||
    anchor.endOffset > endText.length ||
    splitsSurrogate(startText, anchor.startOffset) ||
    splitsSurrogate(endText, anchor.endOffset)
  ) {
    throw new OoxmlError('comment-anchor-unresolved')
  }
  return { start: start.paragraph, end: end.paragraph }
}

function resolveWireParagraph(model: DocumentModelWire, paragraphId: string) {
  const matches = model.stories.flatMap((story) =>
    story.paragraphs.flatMap((paragraph, index) =>
      paragraph.id === paragraphId ? [{ story, paragraph, index }] : [],
    ),
  )
  if (matches.length !== 1) {
    throw new OoxmlError('comment-anchor-unresolved')
  }
  const match = matches[0]
  if (!match) throw new OoxmlError('comment-anchor-unresolved')
  return match
}

function wireParagraphText(paragraph: { runs: { text: string }[] }) {
  return paragraph.runs.map((run) => run.text).join('')
}

function resolveParagraphs(document: OoxmlDocument, comment: DocumentComment) {
  const endpoints = validateCommentAnchor(document.model, comment.anchor)
  const start = anchorParagraph(document, endpoints.start)
  const end =
    endpoints.end === endpoints.start
      ? start
      : anchorParagraph(document, endpoints.end)
  // Both endpoints were validated into one story, so one part must own them.
  if (start.partName !== end.partName) {
    throw new OoxmlError('comment-anchor-unresolved')
  }
  return { start, end }
}

function anchorParagraph(
  document: OoxmlDocument,
  modelParagraph: ParagraphAnchor['wire'],
) {
  const paragraph = document.paragraphAnchors.get(modelParagraph.id)
  if (!paragraph || !sameParagraphModel(paragraph, modelParagraph)) {
    throw new OoxmlError('comment-anchor-unresolved')
  }

  validateSourceText(document, paragraph)
  return paragraph
}

function sameParagraphModel(
  anchor: ParagraphAnchor,
  model: ParagraphAnchor['wire'],
) {
  return (
    anchor.wire.id === model.id &&
    anchor.runs.length === model.runs.length &&
    anchor.runs.every(
      (run, index) =>
        run.wire.id === model.runs[index]?.id &&
        run.wire.text === model.runs[index]?.text,
    )
  )
}

function validateSourceText(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
) {
  const part = document.sourceParts.get(paragraph.partName)
  if (!part?.overlay || part.kind !== 'xml') {
    throw new OoxmlError('comment-anchor-unresolved')
  }
  const source = part.overlay.source
  for (const run of paragraph.runs) {
    const sourceText = editableTextNodes(run)
      .map(({ range, textBreak }) =>
        textBreak
          ? '\n'
          : decodeXmlReferences(
              source.slice(range.startTagEnd, range.endTagStart),
            ),
      )
      .join('')
    if (sourceText !== run.wire.text) {
      throw new OoxmlError('comment-anchor-unresolved')
    }
  }
}

function addMarker(
  document: OoxmlDocument,
  byPart: Map<string, Map<number, PendingInsertion>>,
  paragraph: ParagraphAnchor,
  offset: number,
  marker: Marker,
) {
  const part = document.sourceParts.get(paragraph.partName)
  if (!part?.overlay) throw new OoxmlError('comment-anchor-unresolved')
  const point = locateOffset(part.overlay.source, paragraph, offset)
  let partInsertions = byPart.get(paragraph.partName)
  if (!partInsertions) {
    partInsertions = new Map()
    byPart.set(paragraph.partName, partInsertions)
  }
  const insertion = partInsertions.get(point.sourceOffset)
  if (insertion) {
    if (!sameSplit(insertion.split, point.split)) {
      throw new OoxmlError('comment-anchor-unresolved')
    }
    insertion.markers.push(marker)
  } else {
    partInsertions.set(point.sourceOffset, { ...point, markers: [marker] })
  }
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
// in a run is structure and contributes no offset. One traversal owner so the
// formatting locator, range validation, the comment-anchor validator and the
// imported-marker resolver cannot disagree about a break.
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

function insertionXml(
  source: string,
  insertion: PendingInsertion,
  rewriteFirstHalf: boolean,
) {
  const markers = insertion.markers.sort(compareMarkers).map(markerXml).join('')
  if (!insertion.split) {
    return {
      start: insertion.sourceOffset,
      end: insertion.sourceOffset,
      value: markers,
    }
  }

  if (insertion.split.kind === 'empty-paragraph') {
    const { paragraph } = insertion.split
    const opening = source
      .slice(paragraph.start, paragraph.startTagEnd)
      .replace(/\/\s*>$/u, '>')
    return {
      start: paragraph.start,
      end: paragraph.end,
      value: `${opening}${markers}</w:p>`,
    }
  }

  const { run, textElement, position } = insertion.split
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const properties = run.runProperties.join('')
  let start = insertion.sourceOffset
  let value: string
  if (position === 'content' && textElement) {
    const closeText = source.slice(textElement.endTagStart, textElement.end)
    const openText = preserveTextOpeningTag(
      source.slice(textElement.start, textElement.startTagEnd),
    )
    const firstHalf = rewriteFirstHalf
      ? `${openText}${source.slice(
          textElement.startTagEnd,
          insertion.sourceOffset,
        )}`
      : ''
    if (rewriteFirstHalf) start = textElement.start
    value = `${firstHalf}${closeText}${closeRun}${markers}${openRun}${properties}${openText}`
  } else {
    value = `${closeRun}${markers}${openRun}${properties}`
  }
  return { start, end: insertion.sourceOffset, value }
}

export function preserveTextOpeningTag(opening: string) {
  const xmlSpace = /\s+xml:space\s*=\s*(["'])[^"']*\1/u
  if (xmlSpace.test(opening)) {
    return opening.replace(xmlSpace, ' xml:space="preserve"')
  }
  return opening.replace(/>$/u, ' xml:space="preserve">')
}

function markerXml(marker: Marker) {
  if (marker.kind === 'start') {
    return `<w:commentRangeStart w:id="${marker.ooxmlId}"/>`
  }
  if (marker.kind === 'end') {
    return `<w:commentRangeEnd w:id="${marker.ooxmlId}"/>`
  }
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${marker.ooxmlId}"/></w:r>`
}

function compareMarkers(left: Marker, right: Marker) {
  const difference = markerPriority(left) - markerPriority(right)
  return difference || left.ooxmlId - right.ooxmlId
}

function markerPriority(marker: Marker) {
  if (marker.zeroLength) {
    if (marker.kind === 'start') return 2
    if (marker.kind === 'end') return 3
    return 4
  }
  if (marker.kind === 'end') return 0
  if (marker.kind === 'reference') return 1
  return 5
}

function sameSplit(
  left: SplitPoint | undefined,
  right: SplitPoint | undefined,
) {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'empty-paragraph' && right.kind === 'empty-paragraph') {
    return left.paragraph.start === right.paragraph.start
  }
  if (left.kind !== 'run' || right.kind !== 'run') return false
  return (
    left.run.wire.id === right.run.wire.id &&
    left.position === right.position &&
    left.textElement?.start === right.textElement?.start
  )
}

function splitsSurrogate(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return false
  const previous = value.charCodeAt(offset - 1)
  const next = value.charCodeAt(offset)
  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  )
}
