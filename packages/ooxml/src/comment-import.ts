import {
  DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH,
  type DocumentCommentAnchor,
  type DocumentImportedComment,
  type DocumentRelationshipWire,
} from '@obiter/contracts'

import { editableTextNodes } from './text-offsets'
import type { ParagraphAnchor, SourcePart } from './model'
import { decodeXmlReferences } from './xml-lexemes'
import { parseXmlElements } from './parts/overlay'
import { relationshipKind, resolveRelationshipTarget } from './parts/rels'
import {
  attributeValue,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
} from './parts/xml-elements'

const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'
const WORD_2012_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2012/wordml'
const decoder = new TextDecoder('utf-8', { fatal: true })

type MarkerEndpoint = { anchor: ParagraphAnchor; offset: number }
type RangeEndpoints = { start?: MarkerEndpoint; end?: MarkerEndpoint }
type ExtendedEntry = { paraId: string; parentParaId?: string; done: boolean }

/**
 * Reads the package's own `word/comments.xml` into model comments. A comment
 * whose markers do not resolve is still listed with a null anchor — dropping
 * it would silently lose file content. Comments without a usable `w:id` get an
 * `ooxml-anon-*` identity: displayable but not replyable, because only the
 * file's own numeric id gives a reply a stable target.
 */
export function extractImportedComments(input: {
  relationships: readonly DocumentRelationshipWire[]
  sourceParts: ReadonlyMap<string, SourcePart>
  paragraphAnchors: ReadonlyMap<string, ParagraphAnchor>
}): DocumentImportedComment[] {
  const commentsParts = commentsPartNames(input)
  if (commentsParts.length === 0) return []
  const anchorsByPart = groupAnchorsByPart(input.paragraphAnchors)
  const endpoints = rangeEndpoints(
    input.sourceParts,
    anchorsByPart,
    commentsParts,
  )

  const comments: DocumentImportedComment[] = []
  const usedIds = new Set<string>()
  const paraIdOwner = new Map<string, string>()
  let anonymous = 0

  for (const partName of commentsParts) {
    const part = input.sourceParts.get(partName)
    if (!part || part.kind !== 'xml') continue
    const source = decodePart(part)
    if (!source.trim()) continue
    const elements = parseXmlElements(source)

    for (const element of elements) {
      if (
        !isWord(element, 'comment') ||
        !element.parent ||
        !isWord(element.parent, 'comments')
      ) {
        continue
      }
      const ooxmlId = numericId(attributeValue(element, WORD_NAMESPACE, 'id'))
      const provisionalId =
        ooxmlId === null ? `ooxml-anon-${anonymous}` : `ooxml-${ooxmlId}`
      const named = ooxmlId !== null && !usedIds.has(provisionalId)
      const id = named ? provisionalId : `ooxml-anon-${anonymous}`
      if (id.startsWith('ooxml-anon-')) anonymous += 1
      usedIds.add(id)

      // The comments part is not a story, so body text and paraIds are read
      // straight off the comment element's own paragraphs rather than story
      // anchors.
      const paragraphs = elements.filter(
        (candidate) => isWord(candidate, 'p') && candidate.parent === element,
      )
      const fullBody = paragraphs
        .map((paragraph) =>
          elements
            .filter(
              (candidate) =>
                isWord(candidate, 't') &&
                nearestWordAncestor(candidate, 'p') === paragraph,
            )
            .map((text) =>
              decodeXmlReferences(
                source.slice(text.startTagEnd, text.endTagStart),
              ),
            )
            .join(''),
        )
        .join('\n')
      const bodyTruncated =
        fullBody.length > DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH
      const paraIds = paragraphs.flatMap((paragraph) => {
        const paraId = attributeValue(paragraph, WORD_2010_NAMESPACE, 'paraId')
        return paraId ? [paraId] : []
      })
      for (const paraId of paraIds) paraIdOwner.set(paraId, id)

      comments.push({
        id,
        ooxmlId,
        author: boundedString(
          attributeValue(element, WORD_NAMESPACE, 'author'),
          1000,
        ),
        createdAt: boundedString(
          attributeValue(element, WORD_NAMESPACE, 'date'),
          64,
        ),
        body: bodyTruncated
          ? fullBody.slice(0, DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH)
          : fullBody,
        bodyTruncated,
        paraId: paraIds[0] ?? null,
        anchor:
          named && ooxmlId !== null ? markerAnchor(endpoints, ooxmlId) : null,
        resolved: false,
        parentId: null,
      })
    }
  }

  const order = paragraphOrderIndex(input.paragraphAnchors)
  for (const comment of comments) {
    const anchor = comment.anchor
    if (!anchor) continue
    // Markers are only a valid anchor when the end follows the start in
    // document order; order is the parse-time paragraph sequence.
    const startIndex = order.get(anchor.paragraphId)
    const endIndex = order.get(anchor.endParagraphId ?? anchor.paragraphId)
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      startIndex > endIndex ||
      (startIndex === endIndex && anchor.startOffset > anchor.endOffset)
    ) {
      comment.anchor = null
    }
  }

  for (const entry of extendedEntries(input)) {
    const ownerId = paraIdOwner.get(entry.paraId)
    if (!ownerId) continue
    const comment = comments.find((item) => item.id === ownerId)
    if (!comment) continue
    if (entry.done) comment.resolved = true
    if (entry.parentParaId !== undefined) {
      comment.parentId = paraIdOwner.get(entry.parentParaId) ?? null
    }
  }

  return comments
}

/** The comments parts named by document relationships, in file order. */
function commentsPartNames(input: {
  relationships: readonly DocumentRelationshipWire[]
  sourceParts: ReadonlyMap<string, SourcePart>
}) {
  const names: string[] = []
  for (const relationship of input.relationships) {
    if (relationshipKind(relationship.type) !== 'comments') continue
    const target = resolveRelationshipTarget(relationship)
    if (!target || names.includes(target)) continue
    const part = input.sourceParts.get(target)
    if (part && part.kind === 'xml') names.push(target)
  }
  return names
}

function groupAnchorsByPart(
  paragraphAnchors: ReadonlyMap<string, ParagraphAnchor>,
) {
  const byPart = new Map<string, ParagraphAnchor[]>()
  for (const anchor of paragraphAnchors.values()) {
    const list = byPart.get(anchor.partName)
    if (list) list.push(anchor)
    else byPart.set(anchor.partName, [anchor])
  }
  return byPart
}

/**
 * Pairs `w:commentRangeStart`/`w:commentRangeEnd` markers by `w:id` across
 * every story part except the comments parts themselves, resolving each
 * marker to a paragraph + UTF-16 offset.
 */
function rangeEndpoints(
  sourceParts: ReadonlyMap<string, SourcePart>,
  anchorsByPart: ReadonlyMap<string, ParagraphAnchor[]>,
  commentsParts: readonly string[],
) {
  const excluded = new Set(commentsParts)
  const endpoints = new Map<number, RangeEndpoints>()
  for (const [partName, partAnchors] of anchorsByPart) {
    if (excluded.has(partName)) continue
    const part = sourceParts.get(partName)
    if (!part || part.kind !== 'xml' || !part.overlay) continue
    const source = part.overlay.source
    const anchorByStart = new Map(
      partAnchors.map((anchor) => [anchor.paragraphRange.start, anchor]),
    )
    for (const element of parseXmlElements(source)) {
      const isStart = isWord(element, 'commentRangeStart')
      const isEnd = isWord(element, 'commentRangeEnd')
      if (!isStart && !isEnd) continue
      const ooxmlId = numericId(attributeValue(element, WORD_NAMESPACE, 'id'))
      if (ooxmlId === null) continue
      const paragraphElement = nearestWordAncestor(element, 'p')
      const anchor = paragraphElement
        ? anchorByStart.get(paragraphElement.start)
        : undefined
      if (!anchor) continue
      const pair = endpoints.get(ooxmlId) ?? {}
      pair[isStart ? 'start' : 'end'] = {
        anchor,
        offset: markerOffset(source, anchor, element.start),
      }
      endpoints.set(ooxmlId, pair)
    }
  }
  return endpoints
}

function markerAnchor(
  endpoints: ReadonlyMap<number, RangeEndpoints>,
  ooxmlId: number,
): DocumentCommentAnchor | null {
  const pair = endpoints.get(ooxmlId)
  const start = pair?.start
  const end = pair?.end
  // A range cannot span story parts: paired markers in different parts are
  // malformed, so the comment keeps displayable with a null anchor.
  if (!start || !end || start.anchor.partName !== end.anchor.partName) {
    return null
  }
  return {
    paragraphId: start.anchor.wire.id,
    startOffset: start.offset,
    ...(end.anchor === start.anchor
      ? {}
      : { endParagraphId: end.anchor.wire.id }),
    endOffset: end.offset,
  }
}

/** Parse-time paragraph sequence keyed by wire id, in story order. */
function paragraphOrderIndex(
  paragraphAnchors: ReadonlyMap<string, ParagraphAnchor>,
) {
  const order = new Map<string, number>()
  let index = 0
  for (const anchor of paragraphAnchors.values()) {
    order.set(anchor.wire.id, index)
    index += 1
  }
  return order
}

/**
 * The model offset a marker at a source position lands on: the length of all
 * editable text nodes that end before it, plus the decoded prefix when it
 * falls inside a `w:t` body.
 */
function markerOffset(
  source: string,
  anchor: ParagraphAnchor,
  position: number,
) {
  let offset = 0
  for (const run of anchor.runs) {
    if (position <= run.runRange.start) return offset
    if (position >= run.runRange.end) {
      offset += run.wire.text.length
      continue
    }
    for (const node of editableTextNodes(run)) {
      if (position >= node.range.end) {
        offset += node.textBreak
          ? 1
          : decodeXmlReferences(
              source.slice(node.range.startTagEnd, node.range.endTagStart),
            ).length
        continue
      }
      if (position <= node.range.start) return offset
      offset += decodeXmlReferences(
        sliceBeforeEntityBoundary(
          source.slice(node.range.startTagEnd, position),
        ),
      ).length
      return offset
    }
    return offset
  }
  return offset
}

/** Trims a raw slice back before a trailing unterminated entity reference. */
function sliceBeforeEntityBoundary(raw: string) {
  const amp = raw.lastIndexOf('&')
  if (amp === -1) return raw
  return raw.indexOf(';', amp + 1) === -1 ? raw.slice(0, amp) : raw
}

/** `w15:commentEx` entries from any `commentsExtended` part the file links. */
function extendedEntries(input: {
  relationships: readonly DocumentRelationshipWire[]
  sourceParts: ReadonlyMap<string, SourcePart>
}) {
  const entries: ExtendedEntry[] = []
  for (const relationship of input.relationships) {
    const name = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (name !== 'commentsExtended') continue
    const target = resolveRelationshipTarget(relationship)
    const part = target ? input.sourceParts.get(target) : undefined
    if (!part || part.kind !== 'xml') continue
    const source = decodePart(part)
    if (!source.trim()) continue
    for (const element of parseXmlElements(source)) {
      if (
        element.namespaceUri !== WORD_2012_NAMESPACE ||
        element.localName !== 'commentEx'
      ) {
        continue
      }
      const paraId = attributeValue(element, WORD_2012_NAMESPACE, 'paraId')
      if (!paraId) continue
      const done = attributeValue(element, WORD_2012_NAMESPACE, 'done')
      const parentParaId = attributeValue(
        element,
        WORD_2012_NAMESPACE,
        'paraIdParent',
      )
      entries.push({
        paraId,
        ...(parentParaId !== undefined ? { parentParaId } : {}),
        done: done === '1' || done === 'true',
      })
    }
  }
  return entries
}

function numericId(value: string | undefined) {
  if (value === undefined || !/^-?\d+$/u.test(value)) return null
  const id = Number(value)
  // The wire contract is nonnegative; a negative w:id has no usable reply
  // identity, so the comment falls back to an anonymous ooxml-anon id.
  return Number.isSafeInteger(id) && id >= 0 ? id : null
}

function boundedString(value: string | undefined, max: number) {
  if (value === undefined || value.length > max) return null
  return value
}

function decodePart(part: SourcePart) {
  try {
    return decoder.decode(part.originalPayload)
  } catch {
    // A malformed comments part cannot fail the document; it simply has no
    // extractable comments.
    return ''
  }
}
