import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { parseContentTypes } from './parts/content-types'
import {
  createXmlOverlay,
  escapeXmlAttribute,
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

export const COMMENTS_PART = 'word/comments.xml'
export const COMMENTS_EXTENDED_PART = 'word/commentsExtended.xml'
const DOCUMENT_RELATIONSHIPS_PART = 'word/_rels/document.xml.rels'
const CONTENT_TYPES_PART = '[Content_Types].xml'
const COMMENTS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
export const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'
export const WORD_2012_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2012/wordml'
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function commentExportError() {
  return new OoxmlError('comment-export-failed')
}

/**
 * Resolves the part a relationship kind targets, falling back to the
 * conventional name when the document declares none. A declared but missing
 * or non-XML target fails closed.
 */
export function resolveTypedPartName(
  document: OoxmlDocument,
  kind: 'comments' | 'commentsExtended',
  fallback: string,
) {
  const relationships = document.model.relationships.filter(
    (relationship) =>
      relationship.sourcePartName === 'word/document.xml' &&
      relationship.type.slice(relationship.type.lastIndexOf('/') + 1) === kind,
  )
  if (relationships.length > 1) throw commentExportError()
  const relationship = relationships[0]
  if (!relationship) return fallback
  const target = resolveRelationshipTarget(relationship)
  if (!target) throw commentExportError()
  const part = document.sourceParts.get(target)
  if (!part || part.kind !== 'xml') throw commentExportError()
  return target
}

export function resolveCommentsPartName(document: OoxmlDocument) {
  return resolveTypedPartName(document, 'comments', COMMENTS_PART)
}

export function ensureCommentsPart(document: OoxmlDocument, partName: string) {
  const existing = document.sourceParts.get(partName)
  if (existing) {
    if (existing.kind !== 'xml') throw commentExportError()
    if (!existing.overlay) {
      existing.overlay = createXmlOverlay(decodePart(existing))
    }
    commentsRoot(existing.overlay.source)
    return existing
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:comments>`
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

export function ensureCommentsExtendedPart(
  document: OoxmlDocument,
  partName: string,
) {
  const existing = document.sourceParts.get(partName)
  if (existing) {
    if (existing.kind !== 'xml') throw commentExportError()
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

export function ensureCommentsRelationship(
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
export function ensureDocumentRelationship(
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
      throw commentExportError()
    }
    return
  }
  if (existing.length > 1) throw commentExportError()

  const { part, overlay } = ensureRelationshipsPart(document)
  // Relationship ids already inserted by an earlier ensure in this export
  // live only in pending replacements, so ids are collected from the
  // serialised current state — not the untouched source. The insertion
  // position must still come from the source: overlay replacements are
  // addressed in source coordinates, and the serialised positions shift
  // once the first relationship lands.
  const current = serialiseOverlay(overlay)
  const relationshipIds = parseXmlElements(current)
    .filter(
      (element) =>
        element.namespaceUri === RELATIONSHIPS_NAMESPACE &&
        element.localName === 'Relationship',
    )
    .map((element) => attributeValue(element, '', 'Id'))
    .filter((id): id is string => id !== undefined)
  const root = requiredRoot(
    parseXmlElements(overlay.source),
    RELATIONSHIPS_NAMESPACE,
    'Relationships',
  )
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

export function ensureCommentsContentType(
  document: OoxmlDocument,
  commentsPartName: string,
) {
  ensureContentTypeOverride(document, commentsPartName, COMMENTS_CONTENT_TYPE)
}

export function ensureContentTypeOverride(
  document: OoxmlDocument,
  partName: string,
  contentType: string,
) {
  const { part, overlay } = requiredXmlPart(document, CONTENT_TYPES_PART)
  const index = parseContentTypes(overlay.source)
  const existing = index.overrides.get(partName)
  if (existing) {
    if (existing !== contentType) throw commentExportError()
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

export function commentsRoot(source: string) {
  return requiredRoot(parseXmlElements(source), WORD_NAMESPACE, 'comments')
}

export function requiredRoot(
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
    throw commentExportError()
  }
  return root
}

/**
 * Inserts an element inside the part's root. One replacement owns a
 * self-closing root's expansion: the first child rewrites the whole element
 * and later children append inside that same replacement; a second
 * whole-root replacement would overlap the first and fail serialisation.
 */
export function insertRootChild(
  part: SourcePart,
  overlay: XmlOverlay,
  key: string,
  root: XmlElement,
  value: string,
) {
  if (root.selfClosing) {
    const ownerKey = `${root.localName}:children`
    const close = `</${root.qualifiedName}>`
    const owner = overlay.replacements.get(ownerKey)
    if (owner) {
      if (!owner.value.endsWith(close)) throw commentExportError()
      setOverlayReplacement(overlay, ownerKey, {
        ...owner,
        value: `${owner.value.slice(0, owner.value.length - close.length)}${value}${close}`,
      })
    } else {
      const fragment = overlay.source.slice(root.start, root.end)
      const opening = fragment.replace(/\/\s*>$/u, '>')
      setOverlayReplacement(overlay, ownerKey, {
        start: root.start,
        end: root.end,
        value: `${opening}${value}${close}`,
      })
    }
  } else {
    setOverlayReplacement(overlay, key, {
      start: root.endTagStart,
      end: root.endTagStart,
      value,
    })
  }
  part.dirty = true
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
  if (!part || part.kind !== 'xml') throw commentExportError()
  if (!part.overlay) part.overlay = createXmlOverlay(decodePart(part))
  const overlay = part.overlay
  if (!overlay) throw commentExportError()
  return { part, overlay }
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
    throw commentExportError()
  }
}
