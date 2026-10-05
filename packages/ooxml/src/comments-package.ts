import type { DocumentComment } from '@obiter/contracts'

import type { AllocatedComment } from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { parseContentTypes } from './parts/content-types'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
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
const DOCUMENT_RELATIONSHIPS_PART = 'word/_rels/document.xml.rels'
const CONTENT_TYPES_PART = '[Content_Types].xml'
const COMMENTS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function prepareCommentsPackage(
  document: OoxmlDocument,
  comments: readonly DocumentComment[],
) {
  const commentIds = new Set<string>()
  for (const comment of comments) {
    if (commentIds.has(comment.id)) throw exportError()
    commentIds.add(comment.id)
  }

  const partName = resolveCommentsPartName(document)
  const part = ensureCommentsPart(document, partName)
  ensureCommentsRelationship(document, partName)
  ensureCommentsContentType(document, partName)
  const firstId = highestForeignCommentId(part) + 1
  if (firstId + comments.length - 1 > 2_147_483_647) throw exportError()
  const allocated = [...comments]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map(
      (comment, index) =>
        ({ comment, ooxmlId: firstId + index }) satisfies AllocatedComment,
    )
  return { partName, allocated }
}

export function appendProductComments(
  document: OoxmlDocument,
  partName: string,
  comments: readonly AllocatedComment[],
) {
  const part = document.sourceParts.get(partName)
  if (!part?.overlay || part.kind !== 'xml') throw exportError()
  const overlay = part.overlay
  const root = commentsRoot(overlay.source)
  insertRootChild(
    part,
    overlay,
    'product-comments',
    root,
    comments.map(productCommentXml).join(''),
  )
}

function resolveCommentsPartName(document: OoxmlDocument) {
  const relationships = document.model.relationships.filter(
    (relationship) =>
      relationship.sourcePartName === 'word/document.xml' &&
      isCommentsRelationship(relationship.type),
  )
  if (relationships.length > 1) throw exportError()
  const relationship = relationships[0]
  if (!relationship) return COMMENTS_PART
  const target = resolveRelationshipTarget(relationship)
  if (!target || !document.sourceParts.has(target)) throw exportError()
  return target
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

function ensureCommentsRelationship(
  document: OoxmlDocument,
  commentsPartName: string,
) {
  const existing = document.model.relationships.filter(
    (relationship) =>
      relationship.sourcePartName === 'word/document.xml' &&
      isCommentsRelationship(relationship.type),
  )
  if (existing.length === 1) {
    const relationship = existing[0]
    if (
      !relationship ||
      resolveRelationshipTarget(relationship) !== commentsPartName
    ) {
      throw exportError()
    }
    return
  }
  if (existing.length > 1) throw exportError()

  const { part, overlay } = ensureRelationshipsPart(document)
  const elements = parseXmlElements(overlay.source)
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
  const target = commentsPartName.startsWith('word/')
    ? commentsPartName.slice('word/'.length)
    : `/${commentsPartName}`
  insertRootChild(
    part,
    overlay,
    'product-comments-relationship',
    root,
    `<Relationship Id="${id}" Type="${COMMENTS_RELATIONSHIP}" Target="${escapeXmlAttribute(target)}"/>`,
  )
}

function ensureCommentsContentType(
  document: OoxmlDocument,
  commentsPartName: string,
) {
  const { part, overlay } = requiredXmlPart(document, CONTENT_TYPES_PART)
  const index = parseContentTypes(overlay.source)
  const existing = index.overrides.get(commentsPartName)
  if (existing) {
    if (existing !== COMMENTS_CONTENT_TYPE) throw exportError()
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
    'product-comments-content-type',
    root,
    `<Override PartName="/${escapeXmlAttribute(commentsPartName)}" ContentType="${COMMENTS_CONTENT_TYPE}"/>`,
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

function productCommentXml({ comment, ooxmlId }: AllocatedComment) {
  const body = comment.body
    .split(/\r\n|\r|\n/u)
    .map((line, index) =>
      index === 0
        ? `<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`
        : `<w:br/><w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`,
    )
    .join('')
  return `<w:comment w:id="${ooxmlId}" w:author="${escapeXmlAttribute(comment.author.name)}" w:date="${escapeXmlAttribute(comment.createdAt)}"><w:p><w:r>${body}</w:r></w:p></w:comment>`
}

function isCommentsRelationship(type: string) {
  return type.slice(type.lastIndexOf('/') + 1) === 'comments'
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
