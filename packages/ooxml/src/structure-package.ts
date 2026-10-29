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

const CONTENT_TYPES_PART = '[Content_Types].xml'
const RELATIONSHIPS_ROOT_OPEN = `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">`
const encoder = new TextEncoder()

export { imageExtensionForContentType }

export function relationshipsPartName(sourcePartName: string) {
  const slash = sourcePartName.lastIndexOf('/')
  const directory = slash === -1 ? '' : sourcePartName.slice(0, slash + 1)
  return `${directory}_rels/${sourcePartName.slice(slash + 1)}.rels`
}

function nextRelationshipId(document: OoxmlDocument, sourcePartName: string) {
  const used = new Set(
    document.model.relationships
      .filter((wire) => wire.sourcePartName === sourcePartName)
      .map((wire) => wire.id),
  )
  let candidate = 1
  while (used.has(`rId${candidate}`)) candidate += 1
  return `rId${candidate}`
}

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

export function addXmlStoryPart(
  document: OoxmlDocument,
  partName: string,
  xml: string,
  reservedPartNames: readonly string[] = [],
): SourcePart {
  if (document.sourceParts.has(partName)) {
    throw new OoxmlError('invalid-package')
  }
  const bytes = encoder.encode(xml)
  const reserved = reservedPartNames.filter(
    (name) => !document.sourceParts.has(name),
  ).length
  if (
    bytes.byteLength > OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES ||
    document.sourceParts.size + 1 + reserved > OOXML_MAX_ENTRIES
  ) {
    throw new OoxmlError('package-limits-exceeded')
  }
  let total = bytes.byteLength
  for (const part of document.sourceParts.values()) {
    total += serialisedPartLength(part)
  }
  if (total > OOXML_MAX_UNCOMPRESSED_BYTES) {
    throw new OoxmlError('package-limits-exceeded')
  }
  const part = createOpaquePart(partName, 'xml', bytes)
  part.role = 'story'
  part.overlay = createXmlOverlay(xml)
  part.dirty = true
  document.sourceParts.set(partName, part)
  return part
}

const IMAGE_SIGNATURES = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/bmp': [0x42, 0x4d],
} satisfies Record<DocumentEditImageContentType, readonly number[]>

function matchesImageSignature(
  contentType: DocumentEditImageContentType,
  bytes: Uint8Array,
) {
  const signature = IMAGE_SIGNATURES[contentType]
  return signature.every((value, index) => bytes[index] === value)
}

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
  appendToRootElement(overlay, root, childXml, key)
  return childXml
}

export function insertRootChildXml(
  overlay: XmlOverlay,
  rootName: string,
  childXml: string,
  key: string,
) {
  const root = parseXmlElements(overlay.source).find(
    (element) => element.parent === undefined && element.localName === rootName,
  )
  if (!root) throw new OoxmlError('invalid-document-edit')
  appendToRootElement(overlay, root, childXml, key)
}

function appendToRootElement(
  overlay: XmlOverlay,
  root: XmlElement,
  childXml: string,
  key: string,
) {
  if (root.selfClosing) {
    const ownerKey = `${root.localName}:children`
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
      return
    }
    setOverlayReplacement(overlay, ownerKey, {
      start: root.start,
      end: root.end,
      value: `${overlay.source
        .slice(root.start, root.startTagEnd)
        .replace(/\/\s*>$/u, '>')}${childXml}${close}`,
    })
    return
  }
  setOverlayReplacement(overlay, key, {
    start: root.endTagStart,
    end: root.endTagStart,
    value: childXml,
  })
}

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

export function nextDrawingId(source: CounterSource) {
  return nextCounterId(drawingCounters, source, (id) => `\\bid="${id}"`)
}

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
