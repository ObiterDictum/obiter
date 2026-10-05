import type {
  DocumentEditImageContentType,
  DocumentRelationshipWire,
} from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument } from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  OOXML_MAX_ENTRIES,
  OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  OOXML_MAX_UNCOMPRESSED_BYTES,
} from './package-limits-defaults'
import { parseContentTypes } from './parts/content-types'
import { createOpaquePart } from './parts/opaque'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'

export { IMAGE_RELATIONSHIP_TYPE } from './structure-xml'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const RELATIONSHIPS_ROOT_OPEN =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'

const IMAGE_EXTENSION_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
} satisfies Record<DocumentEditImageContentType, string>

export function imageExtensionForContentType(
  contentType: DocumentEditImageContentType,
) {
  return IMAGE_EXTENSION_BY_CONTENT_TYPE[contentType]
}

export function relationshipsPartName(sourcePartName: string) {
  const slash = sourcePartName.lastIndexOf('/')
  const directory = slash === -1 ? '' : sourcePartName.slice(0, slash + 1)
  return `${directory}_rels/${sourcePartName.slice(slash + 1)}.rels`
}

/**
 * The relationship-id allocator used elsewhere in the codebase: `rId` + a
 * 1-based counter colliding only against the source part's own set.
 */
export function nextRelationshipId(
  document: OoxmlDocument,
  sourcePartName: string,
) {
  const used = new Set(
    document.model.relationships
      .filter((wire) => wire.sourcePartName === sourcePartName)
      .map((wire) => wire.id),
  )
  let candidate = 1
  while (used.has(`rId${candidate}`)) candidate += 1
  return `rId${candidate}`
}

/**
 * Appends a Relationship element to the source part's `.rels` part — creating
 * the part when absent — registers the wire relationship, and marks the part
 * dirty for serialisation.
 */
export function appendRelationship(
  document: OoxmlDocument,
  sourcePartName: string,
  input: { type: string; target: string; targetMode?: 'External' },
) {
  const partName = relationshipsPartName(sourcePartName)
  if (!document.sourceParts.has(partName)) {
    const part = createOpaquePart(
      partName,
      'xml',
      new TextEncoder().encode(`${RELATIONSHIPS_ROOT_OPEN}</Relationships>`),
    )
    part.role = 'relationships'
    part.overlay = createXmlOverlay(
      new TextDecoder().decode(part.originalPayload),
    )
    document.sourceParts.set(partName, part)
  }
  const editable = requireEditablePart(document, partName)
  const id = nextRelationshipId(document, sourcePartName)
  const target = escapeXmlAttribute(input.target)
  const xml = `<Relationship Id="${id}" Type="${input.type}" Target="${target}"${
    input.targetMode ? ` TargetMode="${input.targetMode}"` : ''
  }/>`
  insertRootChild(editable.overlay, 'Relationships', xml, `rel-add-${id}`)
  editable.dirty = true
  const wire: DocumentRelationshipWire = {
    sourcePartName,
    id,
    type: input.type,
    target: input.target,
    ...(input.targetMode ? { targetMode: input.targetMode } : {}),
    sourceFragment: xml,
  }
  document.model.relationships.push(wire)
  return wire
}

/**
 * Ensures `[Content_Types].xml` declares `Extension` as a Default content
 * type. A same-batch insert must not add a second `<Default>` for an
 * extension a pending replacement already declared — duplicate Default
 * elements are invalid OOXML — so pending values are scanned alongside the
 * source.
 */
export function ensureContentTypeDefault(
  document: OoxmlDocument,
  extension: string,
  contentType: string,
) {
  const editable = requireEditablePart(document, CONTENT_TYPES_PART)
  const declared = new Set(
    [...parseContentTypes(editable.overlay.source).defaults.keys()].map(
      (value) => value.toLowerCase(),
    ),
  )
  for (const pending of editable.overlay.replacements.values()) {
    for (const match of pending.value.matchAll(/Extension="([^"]+)"/gu)) {
      if (match[1]) declared.add(match[1].toLowerCase())
    }
  }
  if (declared.has(extension.toLowerCase())) return
  insertRootChild(
    editable.overlay,
    'Types',
    `<Default Extension="${extension}" ContentType="${contentType}"/>`,
    `ct-${extension}`,
  )
  editable.dirty = true
}

/**
 * Adds an image binary part under `word/media`, enforcing the loader's
 * package limits so an edit cannot create a package the reader itself would
 * refuse.
 */
export function addMediaPart(
  document: OoxmlDocument,
  contentType: string,
  bytes: Uint8Array,
) {
  if (!(contentType in IMAGE_EXTENSION_BY_CONTENT_TYPE)) {
    throw new OoxmlError('invalid-document-edit')
  }
  // SAFETY: the `in` check just proved `contentType` is one of the map's
  // keys, which are exactly the DocumentEditImageContentType union.
  const extension =
    IMAGE_EXTENSION_BY_CONTENT_TYPE[contentType as DocumentEditImageContentType]
  if (
    bytes.byteLength > OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES ||
    document.sourceParts.size >= OOXML_MAX_ENTRIES
  ) {
    throw new OoxmlError('package-limits-exceeded')
  }
  let total = 0
  for (const part of document.sourceParts.values()) {
    total += part.originalPayload.byteLength
  }
  if (total + bytes.byteLength > OOXML_MAX_UNCOMPRESSED_BYTES) {
    throw new OoxmlError('package-limits-exceeded')
  }
  let index = 1
  while (document.sourceParts.has(`word/media/image${index}.${extension}`)) {
    index += 1
  }
  const partName = `word/media/image${index}.${extension}`
  document.sourceParts.set(
    partName,
    createOpaquePart(partName, 'binary', bytes),
  )
  ensureContentTypeDefault(document, extension, contentType)
  return partName
}

/**
 * Inserts an element inside a root element, expanding a self-closing root.
 * The content-types and relationships parts are always single-rooted.
 */
function insertRootChild(
  overlay: XmlOverlay,
  rootName: string,
  childXml: string,
  key: string,
) {
  const root = parseXmlElements(overlay.source).find(
    (element) => element.parent === undefined && element.localName === rootName,
  )
  if (!root) throw new OoxmlError('invalid-document-edit')
  if (root.selfClosing) {
    setOverlayReplacement(overlay, key, {
      start: root.start,
      end: root.end,
      value: `${overlay.source
        .slice(root.start, root.startTagEnd)
        .replace(/\/\s*>$/u, '>')}${childXml}</${root.qualifiedName}>`,
    })
    return
  }
  setOverlayReplacement(overlay, key, {
    start: root.endTagStart,
    end: root.endTagStart,
    value: childXml,
  })
}

export type CounterSource = {
  source: string
  replacements: ReadonlyMap<string, { value: string }>
}

const drawingCounters = new WeakMap<object, number>()
const paraIdCounters = new WeakMap<object, number>()

/** A `wp:docPr`/`pic:cNvPr` id unique within the part, pending splices included. */
export function nextDrawingId(source: CounterSource) {
  return nextCounterId(drawingCounters, source, (id) => `\\bid="${id}"`)
}

/**
 * `w14:paraId` values for paragraphs a table insert creates: an `E6`-prefixed
 * hex suffix checked against the source and pending splices, so repeated
 * inserts in one batch never reuse an id.
 */
export function nextSyntheticParaId(source: CounterSource) {
  const id = nextCounterId(
    paraIdCounters,
    source,
    (n) => `w14:paraId="${syntheticParaId(n)}"`,
  )
  return syntheticParaId(id)
}

function syntheticParaId(n: number) {
  return `E6${n.toString(16).toUpperCase().padStart(6, '0')}`
}

function nextCounterId(
  counters: WeakMap<object, number>,
  source: CounterSource,
  pattern: (id: number) => string,
) {
  let id = counters.get(source) ?? 0
  for (;;) {
    id += 1
    const regex = new RegExp(pattern(id), 'u')
    let used = regex.test(source.source)
    if (!used) {
      for (const pending of source.replacements.values()) {
        if (regex.test(pending.value)) {
          used = true
          break
        }
      }
    }
    counters.set(source, id)
    if (!used) return id
  }
}
