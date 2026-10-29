import type { DocumentMarkingsWire } from '@obiter/contracts'

import {
  ensureContentTypeOverride,
  insertRootChild,
  requiredRoot,
} from '../comments-package-parts'
import { OoxmlError, type OoxmlDocument, type SourcePart } from '../model'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
} from './overlay'
import {
  CUSTOM_PROPERTIES_CONTENT_TYPE,
  CUSTOM_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_PART,
  CUSTOM_PROPERTIES_RELATIONSHIP,
  customPropertiesPart,
  decodeCustomPropertiesPart,
  DOC_PROPS_VT_NAMESPACE,
  guardMarkingsRoot,
  MARKING_PROPERTIES,
  markingsWriteError,
  storedCustomProperties,
} from './custom-properties'
import { attributeValue } from './xml-elements'

const encoder = new TextEncoder()

const PACKAGE_RELATIONSHIPS_PART = '_rels/.rels'
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'

export function writeDocumentMarkings(
  document: OoxmlDocument,
  markings: DocumentMarkingsWire,
) {
  try {
    applyMarkings(document, markings)
  } catch (cause) {
    if (cause instanceof OoxmlError) throw cause
    throw markingsWriteError()
  }
}

function applyMarkings(
  document: OoxmlDocument,
  markings: DocumentMarkingsWire,
) {
  const part = ensureCustomPropertiesPart(document)
  if (part.overlay && part.overlay.replacements.size > 0) {
    part.overlay = createXmlOverlay(serialiseOverlay(part.overlay))
  }
  const overlay = part.overlay
  if (!overlay) throw markingsWriteError()
  const { root, properties } = storedCustomProperties(
    overlay.source,
    markingsWriteError,
  )

  const vt = `xmlns:vt="${DOC_PROPS_VT_NAMESPACE}"`
  const wanted = new Map<string, string>()
  if (markings.documentKind !== null) {
    wanted.set(
      MARKING_PROPERTIES.kind,
      `<vt:lpwstr ${vt}>${escapeXmlText(markings.documentKind)}</vt:lpwstr>`,
    )
  }
  for (const key of MARKING_PROPERTIES.flagKeys) {
    wanted.set(
      MARKING_PROPERTIES.flags[key],
      `<vt:bool ${vt}>${markings[key] ? 'true' : 'false'}</vt:bool>`,
    )
  }

  let nextPid =
    properties.reduce(
      (highest, property) => Math.max(highest, property.pid),
      1,
    ) + 1
  const seen = new Set<string>()
  const insertions: string[] = []
  for (const property of properties) {
    if (!MARKING_PROPERTIES.names.has(property.name)) continue
    const value = wanted.get(property.name)
    if (seen.has(property.name) || value === undefined) {
      setOverlayReplacement(overlay, `marking:drop:${property.element.start}`, {
        start: property.element.start,
        end: property.element.end,
        value: '',
      })
      continue
    }
    seen.add(property.name)
    wanted.delete(property.name)
    setOverlayReplacement(overlay, `marking:set:${property.element.start}`, {
      start: property.element.start,
      end: property.element.end,
      value: propertyXml(property.pid || nextPid++, property.name, value),
    })
  }
  for (const [name, value] of wanted) {
    insertions.push(propertyXml(nextPid++, name, value))
  }
  if (insertions.length > 0) {
    guardMarkingsRoot(
      () =>
        insertRootChild(
          part,
          overlay,
          'markings:insert',
          root,
          insertions.join(''),
        ),
      markingsWriteError,
    )
  }
  part.dirty = part.dirty || overlay.replacements.size > 0
  document.model.markings = { ...markings }
}

const PROPERTY_FMTID = '{D5CDD505-2E9C-101B-9997-08002B2B79F9}'

function propertyXml(pid: number, name: string, valueXml: string) {
  return `<property fmtid="${PROPERTY_FMTID}" pid="${pid}" name="${escapeXmlAttribute(name)}">${valueXml}</property>`
}

function ensureCustomPropertiesPart(document: OoxmlDocument) {
  const existing = customPropertiesPart(
    document.model.relationships,
    document.sourceParts,
  )
  if (existing) {
    if (!existing.overlay) {
      existing.overlay = createXmlOverlay(
        decodeCustomPropertiesPart(existing, markingsWriteError),
      )
    }
    return existing
  }

  const orphaned = document.sourceParts.get(CUSTOM_PROPERTIES_PART)
  if (orphaned) {
    return adoptOrphanedCustomPropertiesPart(document)
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="${CUSTOM_PROPERTIES_NAMESPACE}" xmlns:vt="${DOC_PROPS_VT_NAMESPACE}"></Properties>`
  const part: SourcePart = {
    name: CUSTOM_PROPERTIES_PART,
    kind: 'xml',
    role: 'opaque',
    originalPayload: encoder.encode(xml),
    dirty: false,
    overlay: createXmlOverlay(xml),
    trackedChanges: [],
  }
  document.sourceParts.set(CUSTOM_PROPERTIES_PART, part)
  ensurePackageRelationship(document, CUSTOM_PROPERTIES_PART)
  guardMarkingsRoot(
    () =>
      ensureContentTypeOverride(
        document,
        CUSTOM_PROPERTIES_PART,
        CUSTOM_PROPERTIES_CONTENT_TYPE,
      ),
    markingsWriteError,
  )
  return part
}

export function adoptOrphanedCustomPropertiesPart(document: OoxmlDocument) {
  const orphaned = document.sourceParts.get(CUSTOM_PROPERTIES_PART)
  if (!orphaned || orphaned.kind !== 'xml') throw markingsWriteError()
  if (!orphaned.overlay) {
    orphaned.overlay = createXmlOverlay(
      decodeCustomPropertiesPart(orphaned, markingsWriteError),
    )
  }
  storedCustomProperties(orphaned.overlay.source, markingsWriteError)
  ensurePackageRelationship(document, CUSTOM_PROPERTIES_PART)
  guardMarkingsRoot(
    () =>
      ensureContentTypeOverride(
        document,
        CUSTOM_PROPERTIES_PART,
        CUSTOM_PROPERTIES_CONTENT_TYPE,
      ),
    markingsWriteError,
  )
  return orphaned
}

export function markingPropertyXml(
  pid: number,
  name: string,
  value: string | boolean,
) {
  const inner =
    typeof value === 'boolean'
      ? `<vt:bool xmlns:vt="${DOC_PROPS_VT_NAMESPACE}">${value ? 'true' : 'false'}</vt:bool>`
      : `<vt:lpwstr xmlns:vt="${DOC_PROPS_VT_NAMESPACE}">${escapeXmlText(value)}</vt:lpwstr>`
  return propertyXml(pid, name, inner)
}

function ensurePackageRelationship(document: OoxmlDocument, partName: string) {
  const part = document.sourceParts.get(PACKAGE_RELATIONSHIPS_PART)
  if (!part || part.kind !== 'xml') throw markingsWriteError()
  if (!part.overlay) {
    part.overlay = createXmlOverlay(
      decodeCustomPropertiesPart(part, markingsWriteError),
    )
  }
  const overlay = part.overlay
  const current = serialiseOverlay(overlay)
  const declared = parseXmlElements(current).filter(
    (element) =>
      element.namespaceUri === RELATIONSHIPS_NAMESPACE &&
      element.localName === 'Relationship',
  )
  if (
    declared.some(
      (element) =>
        attributeValue(element, '', 'Type') === CUSTOM_PROPERTIES_RELATIONSHIP,
    )
  ) {
    return
  }
  const ids = new Set(
    declared.map((element) => attributeValue(element, '', 'Id')),
  )
  const root = guardMarkingsRoot(
    () =>
      requiredRoot(
        parseXmlElements(overlay.source),
        RELATIONSHIPS_NAMESPACE,
        'Relationships',
      ),
    markingsWriteError,
  )
  let id = 'rIdObiterCustomProps'
  let suffix = 2
  while (ids.has(id)) {
    id = `rIdObiterCustomProps${suffix}`
    suffix += 1
  }
  guardMarkingsRoot(
    () =>
      insertRootChild(
        part,
        overlay,
        'product-relationship:custom-properties',
        root,
        `<Relationship Id="${id}" Type="${CUSTOM_PROPERTIES_RELATIONSHIP}" Target="${escapeXmlAttribute(`/${partName}`)}"/>`,
      ),
    markingsWriteError,
  )
}
