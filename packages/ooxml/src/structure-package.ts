import {
  documentEditImageContentTypeSchema,
  imageExtensionForContentType,
  type DocumentEditImageContentType,
  type DocumentRelationshipWire,
} from '@obiter/contracts'

import { WORD_2010_NAMESPACE } from './document-identity'
import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  OOXML_MAX_ENTRIES,
  OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  OOXML_MAX_UNCOMPRESSED_BYTES,
} from './package-limits-defaults'
import {
  CONTENT_TYPES_NAMESPACE,
  parseContentTypes,
} from './parts/content-types'
import { createOpaquePart } from './parts/opaque'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { RELATIONSHIPS_NAMESPACE } from './parts/rels'
import type { XmlElement } from './parts/xml-elements'

export { IMAGE_RELATIONSHIP_TYPE } from './structure-xml'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const RELATIONSHIPS_ROOT_OPEN = `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">`
const encoder = new TextEncoder()

export { imageExtensionForContentType }

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
  const xml = insertRootChild(
    editable.overlay,
    'Relationships',
    'Relationship',
    `Id="${id}" Type="${input.type}" Target="${target}"${
      input.targetMode ? ` TargetMode="${input.targetMode}"` : ''
    }`,
    `rel-add-${id}`,
    RELATIONSHIPS_NAMESPACE,
  )
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
 * Ensures the inserted media part resolves to `contentType`. A missing
 * extension gets a `<Default>`; an existing Default that maps the extension
 * to a different type must be preserved for the parts that rely on it, so
 * this part takes a `<Override>` instead. Declarations are read from the
 * part as it would serialise — pending same-batch inserts included — so the
 * effective type, not just the presence of any declaration, decides.
 */
export function ensureMediaContentType(
  document: OoxmlDocument,
  partName: string,
  extension: string,
  contentType: string,
) {
  const editable = requireEditablePart(document, CONTENT_TYPES_PART)
  let effective
  try {
    effective = parseContentTypes(serialiseOverlay(editable.overlay))
  } catch {
    throw new OoxmlError('serialisation-failed')
  }
  const override = effective.overrides.get(partName)
  if (override === contentType) return
  // A second Override for one part name is invalid OOXML — a conflicting one
  // cannot be papered over.
  if (override !== undefined) throw new OoxmlError('invalid-document-edit')
  const declared = effective.defaults.get(extension.toLowerCase())
  if (declared === contentType) return
  if (declared === undefined) {
    insertRootChild(
      editable.overlay,
      'Types',
      'Default',
      `Extension="${extension}" ContentType="${contentType}"`,
      `ct-default-${extension}`,
      CONTENT_TYPES_NAMESPACE,
    )
    editable.dirty = true
    return
  }
  insertRootChild(
    editable.overlay,
    'Types',
    'Override',
    `PartName="/${partName}" ContentType="${contentType}"`,
    `ct-override-${partName}`,
    CONTENT_TYPES_NAMESPACE,
  )
  editable.dirty = true
}

/**
 * Adds an image binary part under `word/media`, enforcing the loader's
 * package limits so an edit cannot create a package the reader itself would
 * refuse. `reservedPartNames` lists every other part the same insertion will
 * create (a relationships part, for example), so the entry count guards the
 * finished package; dirty parts are weighed at their serialised size because
 * the original payload ignores pending growth.
 */
export function addMediaPart(
  document: OoxmlDocument,
  contentType: string,
  bytes: Uint8Array,
  reservedPartNames: readonly string[] = [],
) {
  const parsed = documentEditImageContentTypeSchema.safeParse(contentType)
  if (!parsed.success) {
    throw new OoxmlError('invalid-document-edit')
  }
  const extension = imageExtensionForContentType(parsed.data)
  if (!matchesImageSignature(parsed.data, bytes)) {
    throw new OoxmlError('invalid-document-edit')
  }
  const reserved = reservedPartNames.filter(
    (name) => !document.sourceParts.has(name),
  ).length
  if (
    bytes.byteLength > OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES ||
    document.sourceParts.size + 1 + reserved > OOXML_MAX_ENTRIES
  ) {
    throw new OoxmlError('package-limits-exceeded')
  }
  let total = 0
  for (const part of document.sourceParts.values()) {
    total += serialisedPartLength(part)
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
  ensureMediaContentType(document, partName, extension, contentType)
  return partName
}

/** The byte signature each supported raster type must actually carry. */
const IMAGE_SIGNATURES = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/bmp': [0x42, 0x4d],
} satisfies Record<DocumentEditImageContentType, readonly number[]>

/**
 * The declared content type is a client claim; the bytes are the truth. A
 * mismatch would write a part whose payload disagrees with its declared type,
 * so the signature is verified before the part exists.
 */
function matchesImageSignature(
  contentType: DocumentEditImageContentType,
  bytes: Uint8Array,
) {
  const signature = IMAGE_SIGNATURES[contentType]
  return signature.every((value, index) => bytes[index] === value)
}

/** The size a part contributes to the serialised package. */
function serialisedPartLength(part: SourcePart) {
  if (!part.dirty) return part.originalPayload.byteLength
  if (part.kind !== 'xml' || !part.overlay) {
    throw new OoxmlError('serialisation-failed')
  }
  try {
    return encoder.encode(serialiseOverlay(part.overlay)).byteLength
  } catch {
    throw new OoxmlError('serialisation-failed')
  }
}

/**
 * Inserts an element inside a root element, expanding a self-closing root,
 * and returns the child XML as emitted. The content-types and relationships
 * parts are always single-rooted.
 *
 * One replacement owns the root's expansion: the first child rewrites the
 * whole self-closing element and later children append inside that same
 * replacement — a second whole-root replacement would overlap the first and
 * fail serialisation.
 */
function insertRootChild(
  overlay: XmlOverlay,
  rootName: string,
  childName: string,
  attributesXml: string,
  key: string,
  namespaceUri: string,
) {
  const root = parseXmlElements(overlay.source).find(
    (element) => element.parent === undefined && element.localName === rootName,
  )
  if (!root) throw new OoxmlError('invalid-document-edit')
  const childXml = qualifiedChildXml(
    root,
    childName,
    attributesXml,
    namespaceUri,
  )
  if (root.selfClosing) {
    const ownerKey = `${rootName}:children`
    const close = `</${root.qualifiedName}>`
    const owner = overlay.replacements.get(ownerKey)
    if (owner) {
      if (!owner.value.endsWith(close)) {
        throw new OoxmlError('invalid-document-edit')
      }
      setOverlayReplacement(overlay, ownerKey, {
        ...owner,
        value: `${owner.value.slice(0, owner.value.length - close.length)}${childXml}${close}`,
      })
      return childXml
    }
    setOverlayReplacement(overlay, ownerKey, {
      start: root.start,
      end: root.end,
      value: `${overlay.source
        .slice(root.start, root.startTagEnd)
        .replace(/\/\s*>$/u, '>')}${childXml}${close}`,
    })
    return childXml
  }
  setOverlayReplacement(overlay, key, {
    start: root.endTagStart,
    end: root.endTagStart,
    value: childXml,
  })
  return childXml
}

/**
 * Emits the child in the root's resolved namespace. A prefixed root passes
 * its prefix down (`pkg:Relationships` gets `pkg:Relationship` children); an
 * unprefixed root relies on its default namespace, and a root bound to no
 * namespace needs the child to declare the part's namespace explicitly — an
 * unprefixed child there would resolve to no namespace and be dropped on
 * reload.
 */
function qualifiedChildXml(
  root: XmlElement,
  childName: string,
  attributesXml: string,
  namespaceUri: string,
) {
  const colon = root.qualifiedName.indexOf(':')
  if (colon !== -1) {
    return `<${root.qualifiedName.slice(0, colon)}:${childName} ${attributesXml}/>`
  }
  const declaration = root.namespaceUri === '' ? ` xmlns="${namespaceUri}"` : ''
  return `<${childName}${declaration} ${attributesXml}/>`
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
 *
 * Source ids are collected namespace-resolved: the attribute is matched by
 * the w14 namespace URI, not its spelling, so `alias:paraId`, single quotes
 * and whitespace around `=` cannot slip a collision past the allocator.
 * Pending splice values are fragments whose namespace bindings may live
 * outside them, so every prefixed spelling is scanned — over-matching only
 * costs an id; under-matching allocates a duplicate.
 */
export function nextSyntheticParaId(source: CounterSource) {
  const used = new Set(sourceParaIds(source))
  for (const pending of source.replacements.values()) {
    for (const match of pending.value.matchAll(PENDING_PARA_ID)) {
      if (match[1]) used.add(match[1].toUpperCase())
    }
  }
  let id = paraIdCounters.get(source) ?? 0
  for (;;) {
    id += 1
    paraIdCounters.set(source, id)
    const candidate = syntheticParaId(id)
    if (!used.has(candidate)) return candidate
  }
}

const PENDING_PARA_ID = /\b[\w.-]+:paraId\s*=\s*["']([0-9A-Fa-f]{8})["']/gu
const PARA_ID_VALUE = /^[0-9A-Fa-f]{8}$/u

const paraIdsInSource = new WeakMap<CounterSource, ReadonlySet<string>>()

/** The paraId values the part source already uses, keyed by namespace URI. */
function sourceParaIds(source: CounterSource) {
  const cached = paraIdsInSource.get(source)
  if (cached) return cached
  const found = new Set<string>()
  for (const element of parseXmlElements(source.source)) {
    for (const attribute of element.attributes) {
      if (
        attribute.namespaceUri === WORD_2010_NAMESPACE &&
        attribute.localName === 'paraId' &&
        PARA_ID_VALUE.test(attribute.value)
      ) {
        found.add(attribute.value.toUpperCase())
      }
    }
  }
  paraIdsInSource.set(source, found)
  return found
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
