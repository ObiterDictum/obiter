import type { DocumentComment, DocumentCommentReply } from '@obiter/contracts'

import type { AllocatedComment, AllocatedReply } from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { parseContentTypes } from './parts/content-types'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { resolveRelationshipTarget } from './parts/rels'
import {
  attributeValue,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'

const COMMENTS_PART = 'word/comments.xml'
const COMMENTS_EXTENDED_PART = 'word/commentsExtended.xml'
const DOCUMENT_RELATIONSHIPS_PART = 'word/_rels/document.xml.rels'
const CONTENT_TYPES_PART = '[Content_Types].xml'
const COMMENTS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_EXTENDED_RELATIONSHIP =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const COMMENTS_EXTENDED_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'
const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'
const WORD_2012_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2012/wordml'
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export type ProductReply = Extract<DocumentCommentReply, { imported: false }>

/**
 * A product-authored reply to a comment the package itself carries. The
 * caller resolves the thread head's numeric `w:id` and `w14:paraId` from the
 * exported document's own model; without a `paraId` the reply still exports
 * but cannot thread under its parent.
 */
export type ImportedThreadReply = {
  ooxmlId: number | null
  paraId: string | null
  reply: ProductReply
}

export type AllocatedImportedReply = {
  ooxmlId: number
  /** The reply's own emitted `w14:paraId`; null when it cannot be threaded. */
  paraId: string | null
  /** The imported head's `w14:paraId` the commentEx entry threads under. */
  parentParaId: string | null
  reply: ProductReply
}

/** A `w15:commentEx` entry to append to the commentsExtended part. */
export type ExtendedCommentEntry = {
  paraId: string
  parentParaId?: string
  done?: boolean
}

export function prepareCommentsPackage(
  document: OoxmlDocument,
  comments: readonly DocumentComment[],
  importedReplies: readonly ImportedThreadReply[] = [],
) {
  const emittedIds = new Set<string>()
  for (const comment of comments) {
    if (emittedIds.has(comment.id)) throw exportError()
    emittedIds.add(comment.id)
    for (const reply of comment.replies) {
      if (reply.imported || emittedIds.has(reply.id)) throw exportError()
      emittedIds.add(reply.id)
    }
  }
  for (const { reply } of importedReplies) {
    if (reply.imported || emittedIds.has(reply.id)) throw exportError()
    emittedIds.add(reply.id)
  }

  const partName = resolveCommentsPartName(document)
  const part = ensureCommentsPart(document, partName)
  ensureCommentsRelationship(document, partName)
  ensureCommentsContentType(document, partName)
  const firstId = highestForeignCommentId(part) + 1
  const emissionCount =
    comments.length +
    comments.reduce((count, comment) => count + comment.replies.length, 0) +
    importedReplies.length
  if (firstId + emissionCount - 1 > 2_147_483_647) throw exportError()
  const nextParaId = paraIdAllocator(commentParaIds(part))

  let nextId = firstId
  const allocated = [...comments]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map((comment) => {
      // The dedupe pass above already rejected imported replies on a product
      // thread; narrow again so the allocator sees only product rows.
      const productReplies = comment.replies.filter(
        (reply): reply is ProductReply => !reply.imported,
      )
      const allocatedComment: AllocatedComment = {
        comment,
        ooxmlId: nextId,
        // A paraId is only emitted when commentsExtended metadata must name
        // the comment: replies to thread or a done flag to record.
        paraId:
          comment.resolvedAt !== null || productReplies.length > 0
            ? nextParaId()
            : null,
        replies: [],
      }
      nextId += 1
      allocatedComment.replies = [...productReplies]
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .map((reply) => {
          const allocatedReply: AllocatedReply = {
            reply,
            ooxmlId: nextId,
            paraId: nextParaId(),
          }
          nextId += 1
          return allocatedReply
        })
      return allocatedComment
    })

  const allocatedImportedReplies: AllocatedImportedReply[] = [
    ...importedReplies,
  ]
    .sort(
      (left, right) =>
        (left.ooxmlId ?? Number.MAX_SAFE_INTEGER) -
          (right.ooxmlId ?? Number.MAX_SAFE_INTEGER) ||
        (left.reply.id < right.reply.id
          ? -1
          : left.reply.id > right.reply.id
            ? 1
            : 0),
    )
    .map(({ paraId, reply }) => {
      const allocatedReply: AllocatedImportedReply = {
        reply,
        ooxmlId: nextId,
        paraId: paraId === null ? null : nextParaId(),
        parentParaId: paraId,
      }
      nextId += 1
      return allocatedReply
    })
  return { partName, allocated, importedReplies: allocatedImportedReplies }
}

/**
 * Appends the product comments and their replies to the comments part and
 * returns the `w15:commentEx` entries needed to thread replies and record
 * done state — the caller writes them into the commentsExtended part.
 */
export function appendProductComments(
  document: OoxmlDocument,
  partName: string,
  comments: readonly AllocatedComment[],
  importedReplies: readonly AllocatedImportedReply[],
): ExtendedCommentEntry[] {
  const part = document.sourceParts.get(partName)
  if (!part?.overlay || part.kind !== 'xml') throw exportError()
  const overlay = part.overlay
  const root = commentsRoot(overlay.source)

  const fragments: string[] = []
  const extended: ExtendedCommentEntry[] = []
  for (const { comment, ooxmlId, paraId, replies } of comments) {
    fragments.push(
      productCommentXml({
        ooxmlId,
        author: comment.author.name,
        createdAt: comment.createdAt,
        body: comment.body,
        paraId,
      }),
    )
    if (comment.resolvedAt !== null && paraId !== null) {
      extended.push({ paraId, done: true })
    }
    for (const reply of replies) {
      fragments.push(
        productCommentXml({
          ooxmlId: reply.ooxmlId,
          author: reply.reply.author.name,
          createdAt: reply.reply.createdAt,
          body: reply.reply.body,
          paraId: reply.paraId,
        }),
      )
      if (paraId !== null && reply.paraId !== null) {
        extended.push({ paraId: reply.paraId, parentParaId: paraId })
      }
    }
  }
  for (const { ooxmlId, paraId, parentParaId, reply } of importedReplies) {
    fragments.push(
      productCommentXml({
        ooxmlId,
        author: reply.author.name,
        createdAt: reply.createdAt,
        body: reply.body,
        paraId,
      }),
    )
    if (paraId !== null && parentParaId !== null) {
      extended.push({ paraId, parentParaId })
    }
  }

  insertRootChild(part, overlay, 'product-comments', root, fragments.join(''))
  return extended
}

/** Appends `w15:commentEx` entries, creating the part when it is absent. */
export function appendCommentsExtended(
  document: OoxmlDocument,
  entries: readonly ExtendedCommentEntry[],
) {
  if (entries.length === 0) return
  const partName = resolveTypedPartName(
    document,
    'commentsExtended',
    COMMENTS_EXTENDED_PART,
  )
  const part = ensureCommentsExtendedPart(document, partName)
  ensureDocumentRelationship(document, partName, COMMENTS_EXTENDED_RELATIONSHIP)
  ensureContentTypeOverride(document, partName, COMMENTS_EXTENDED_CONTENT_TYPE)
  const overlay = part.overlay
  if (!overlay) throw exportError()
  const root = requiredRoot(
    parseXmlElements(overlay.source),
    WORD_2012_NAMESPACE,
    'commentsEx',
  )
  insertRootChild(
    part,
    overlay,
    'product-comments-extended',
    root,
    entries.map(extendedEntryXml).join(''),
  )
}

function extendedEntryXml(entry: ExtendedCommentEntry) {
  const parent =
    entry.parentParaId === undefined
      ? ''
      : ` w15:paraIdParent="${escapeXmlAttribute(entry.parentParaId)}"`
  const done = entry.done === true ? ' w15:done="1"' : ''
  return `<w15:commentEx w15:paraId="${escapeXmlAttribute(entry.paraId)}"${parent}${done}/>`
}

/**
 * Resolves the part a relationship kind targets, falling back to the
 * conventional name when the document declares none. A declared but missing
 * or non-XML target fails closed.
 */
function resolveTypedPartName(
  document: OoxmlDocument,
  kind: 'comments' | 'commentsExtended',
  fallback: string,
) {
  const relationships = document.model.relationships.filter(
    (relationship) =>
      relationship.sourcePartName === 'word/document.xml' &&
      relationship.type.slice(relationship.type.lastIndexOf('/') + 1) === kind,
  )
  if (relationships.length > 1) throw exportError()
  const relationship = relationships[0]
  if (!relationship) return fallback
  const target = resolveRelationshipTarget(relationship)
  if (!target) throw exportError()
  const part = document.sourceParts.get(target)
  if (!part || part.kind !== 'xml') throw exportError()
  return target
}

function resolveCommentsPartName(document: OoxmlDocument) {
  return resolveTypedPartName(document, 'comments', COMMENTS_PART)
}

function ensureCommentsPart(document: OoxmlDocument, partName: string) {
  const existing = document.sourceParts.get(partName)
  if (existing) {
    if (existing.kind !== 'xml') throw exportError()
    if (!existing.overlay) {
      existing.overlay = createXmlOverlay(decodePart(existing))
    }
    commentsRoot(existing.overlay.source)
    return existing
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${WORD_NAMESPACE}"></w:comments>`
  const part: SourcePart = {
    name: partName,
    kind: 'xml',
    role: 'story',
    originalPayload: encoder.encode(xml),
    dirty: false,
    overlay: createXmlOverlay(xml),
    trackedChanges: [],
  }
  document.sourceParts.set(partName, part)
  return part
}

function ensureCommentsExtendedPart(document: OoxmlDocument, partName: string) {
  const existing = document.sourceParts.get(partName)
  if (existing) {
    if (existing.kind !== 'xml') throw exportError()
    if (!existing.overlay) {
      existing.overlay = createXmlOverlay(decodePart(existing))
    }
    requiredRoot(
      parseXmlElements(existing.overlay.source),
      WORD_2012_NAMESPACE,
      'commentsEx',
    )
    return existing
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="${WORD_2012_NAMESPACE}"></w15:commentsEx>`
  const part: SourcePart = {
    name: partName,
    kind: 'xml',
    role: 'opaque',
    originalPayload: encoder.encode(xml),
    dirty: false,
    overlay: createXmlOverlay(xml),
    trackedChanges: [],
  }
  document.sourceParts.set(partName, part)
  return part
}

function ensureCommentsRelationship(
  document: OoxmlDocument,
  commentsPartName: string,
) {
  ensureDocumentRelationship(document, commentsPartName, COMMENTS_RELATIONSHIP)
}

/**
 * Adds a `word/document.xml` relationship to `partName` when no relationship
 * of that type exists; a declared relationship pointing elsewhere fails
 * closed rather than redirecting a foreign part.
 */
function ensureDocumentRelationship(
  document: OoxmlDocument,
  partName: string,
  relationshipType: string,
) {
  const kind = relationshipType.slice(relationshipType.lastIndexOf('/') + 1)
  const existing = document.model.relationships.filter(
    (relationship) =>
      relationship.sourcePartName === 'word/document.xml' &&
      relationship.type.slice(relationship.type.lastIndexOf('/') + 1) === kind,
  )
  if (existing.length === 1) {
    const relationship = existing[0]
    if (
      !relationship ||
      relationship.type !== relationshipType ||
      resolveRelationshipTarget(relationship) !== partName
    ) {
      throw exportError()
    }
    return
  }
  if (existing.length > 1) throw exportError()

  const { part, overlay } = ensureRelationshipsPart(document)
  // Relationship ids already inserted by an earlier ensure in this export
  // live only in pending replacements, so ids are collected from the
  // serialised current state — not the untouched source.
  const current = serialiseOverlay(overlay)
  const elements = parseXmlElements(current)
  const root = requiredRoot(elements, RELATIONSHIPS_NAMESPACE, 'Relationships')
  const relationshipIds = elements
    .filter(
      (element) =>
        element.namespaceUri === RELATIONSHIPS_NAMESPACE &&
        element.localName === 'Relationship',
    )
    .map((element) => attributeValue(element, '', 'Id'))
    .filter((id): id is string => id !== undefined)
  const id = uniqueRelationshipId(relationshipIds)
  const target = partName.startsWith('word/')
    ? partName.slice('word/'.length)
    : `/${partName}`
  insertRootChild(
    part,
    overlay,
    `product-relationship:${kind}`,
    root,
    `<Relationship Id="${id}" Type="${relationshipType}" Target="${escapeXmlAttribute(target)}"/>`,
  )
}

function ensureCommentsContentType(
  document: OoxmlDocument,
  commentsPartName: string,
) {
  ensureContentTypeOverride(document, commentsPartName, COMMENTS_CONTENT_TYPE)
}

function ensureContentTypeOverride(
  document: OoxmlDocument,
  partName: string,
  contentType: string,
) {
  const { part, overlay } = requiredXmlPart(document, CONTENT_TYPES_PART)
  const index = parseContentTypes(overlay.source)
  const existing = index.overrides.get(partName)
  if (existing) {
    if (existing !== contentType) throw exportError()
    return
  }

  const root = requiredRoot(
    parseXmlElements(overlay.source),
    CONTENT_TYPES_NAMESPACE,
    'Types',
  )
  insertRootChild(
    part,
    overlay,
    `product-content-type:${partName}`,
    root,
    `<Override PartName="/${escapeXmlAttribute(partName)}" ContentType="${contentType}"/>`,
  )
}

function highestForeignCommentId(part: SourcePart) {
  if (!part.overlay) throw exportError()
  let highest = -1
  for (const element of parseXmlElements(part.overlay.source)) {
    if (
      element.namespaceUri !== WORD_NAMESPACE ||
      element.localName !== 'comment'
    ) {
      continue
    }
    const value = attributeValue(element, WORD_NAMESPACE, 'id')
    if (value && /^-?\d+$/u.test(value)) {
      const numericId = Number(value)
      if (!Number.isSafeInteger(numericId)) throw exportError()
      highest = Math.max(highest, numericId)
    }
  }
  return highest
}

/** Every `w14:paraId` the comments part already carries, for collision-free allocation. */
function commentParaIds(part: SourcePart) {
  if (!part.overlay) throw exportError()
  const ids = new Set<string>()
  for (const element of parseXmlElements(part.overlay.source)) {
    const paraId = attributeValue(element, WORD_2010_NAMESPACE, 'paraId')
    if (paraId) ids.add(paraId)
  }
  return ids
}

/**
 * Deterministic 8-hex-digit paraIds in a product-owned band. The counter
 * bumps until the id is unused in the comments part, so a foreign paraId can
 * never be claimed for a product comment.
 */
function paraIdAllocator(used: ReadonlySet<string>) {
  let counter = 0
  return () => {
    for (;;) {
      const candidate = (0x0b1e0000 + counter)
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
      counter += 1
      if (!used.has(candidate)) return candidate
    }
  }
}

function commentsRoot(source: string) {
  return requiredRoot(parseXmlElements(source), WORD_NAMESPACE, 'comments')
}

function requiredRoot(
  elements: XmlElement[],
  namespaceUri: string,
  localName: string,
) {
  const roots = elements.filter(({ depth }) => depth === 0)
  const root = roots[0]
  if (
    roots.length !== 1 ||
    !root ||
    root.namespaceUri !== namespaceUri ||
    root.localName !== localName
  ) {
    throw exportError()
  }
  return root
}

function ensureRelationshipsPart(document: OoxmlDocument) {
  if (!document.sourceParts.has(DOCUMENT_RELATIONSHIPS_PART)) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"></Relationships>`
    document.sourceParts.set(DOCUMENT_RELATIONSHIPS_PART, {
      name: DOCUMENT_RELATIONSHIPS_PART,
      kind: 'xml',
      role: 'relationships',
      originalPayload: encoder.encode(xml),
      dirty: false,
      overlay: createXmlOverlay(xml),
      trackedChanges: [],
    })
  }
  return requiredXmlPart(document, DOCUMENT_RELATIONSHIPS_PART)
}

function requiredXmlPart(document: OoxmlDocument, name: string) {
  const part = document.sourceParts.get(name)
  if (!part || part.kind !== 'xml') throw exportError()
  if (!part.overlay) part.overlay = createXmlOverlay(decodePart(part))
  const overlay = part.overlay
  if (!overlay) throw exportError()
  return { part, overlay }
}

function insertRootChild(
  part: SourcePart,
  overlay: XmlOverlay,
  key: string,
  root: XmlElement,
  value: string,
) {
  if (root.selfClosing) {
    const fragment = overlay.source.slice(root.start, root.end)
    const opening = fragment.replace(/\/\s*>$/u, '>')
    setOverlayReplacement(overlay, key, {
      start: root.start,
      end: root.end,
      value: `${opening}${value}</${root.qualifiedName}>`,
    })
  } else {
    setOverlayReplacement(overlay, key, {
      start: root.endTagStart,
      end: root.endTagStart,
      value,
    })
  }
  part.dirty = true
}

function productCommentXml(input: {
  ooxmlId: number
  author: string
  createdAt: string
  body: string
  paraId: string | null
}) {
  const body = input.body
    .split(/\r\n|\r|\n/u)
    .map((line, index) =>
      index === 0
        ? `<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`
        : `<w:br/><w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`,
    )
    .join('')
  // The w14 prefix is declared on the element itself so emitted comments
  // stay well-formed inside a foreign comments part whatever its root
  // namespaces declare.
  const namespace =
    input.paraId === null ? '' : ` xmlns:w14="${WORD_2010_NAMESPACE}"`
  const paraId =
    input.paraId === null
      ? ''
      : ` w14:paraId="${escapeXmlAttribute(input.paraId)}"`
  return `<w:comment w:id="${input.ooxmlId}" w:author="${escapeXmlAttribute(input.author)}" w:date="${escapeXmlAttribute(input.createdAt)}"${namespace}><w:p${paraId}><w:r>${body}</w:r></w:p></w:comment>`
}

function uniqueRelationshipId(existing: readonly string[]) {
  const used = new Set(existing)
  let candidate = 'rIdObiterComments'
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `rIdObiterComments${suffix}`
    suffix += 1
  }
  return candidate
}

function decodePart(part: SourcePart) {
  try {
    return decoder.decode(part.originalPayload)
  } catch {
    throw exportError()
  }
}

function exportError() {
  return new OoxmlError('comment-export-failed')
}
