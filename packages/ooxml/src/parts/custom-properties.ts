import {
  EMPTY_DOCUMENT_MARKINGS,
  type DocumentMarkingsWire,
  type DocumentRelationshipWire,
} from '@obiter/contracts'

import {
  ensureContentTypeOverride,
  insertRootChild,
  requiredRoot,
} from '../comments-package-parts'
import { OoxmlError, type OoxmlDocument, type SourcePart } from '../model'
import { decodeXmlReferences } from '../xml-lexemes'
import {
  createXmlOverlay,
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
} from './overlay'
import { resolveRelationshipTarget } from './rels'
import { attributeValue, type XmlElement } from './xml-elements'

export const CUSTOM_PROPERTIES_PART = 'docProps/custom.xml'
export const CUSTOM_PROPERTIES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'
export const CUSTOM_PROPERTIES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml'
export const CUSTOM_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const DOC_PROPS_VT_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
const PACKAGE_RELATIONSHIPS_PART = '_rels/.rels'
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * The property names the markings round-trip through. They are namespaced to
 * the product so foreign custom properties — which a legal document may
 * carry from its DMS — survive a markings write untouched.
 */
const MARKING_KIND_PROPERTY = 'obiter.documentKind'
const MARKING_FLAG_PROPERTIES = {
  draft: 'obiter.draft',
  privileged: 'obiter.privileged',
  withoutPrejudice: 'obiter.withoutPrejudice',
} as const
const MARKING_FLAG_KEYS = ['draft', 'privileged', 'withoutPrejudice'] as const
const MARKING_PROPERTY_NAMES = new Set([
  MARKING_KIND_PROPERTY,
  ...Object.values(MARKING_FLAG_PROPERTIES),
])

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function markingsError(): OoxmlError {
  return new OoxmlError('invalid-xml-part')
}

function writeError(): OoxmlError {
  return new OoxmlError('invalid-document-edit')
}

/**
 * The shared comments-package helpers report every structural failure as
 * `comment-export-failed`. In this part that code would mislabel a markings
 * problem, so the calls run inside the narrowest conversion the error type
 * allows.
 */
function guardRoot<T>(make: () => T, error: () => OoxmlError): T {
  try {
    return make()
  } catch (cause) {
    if (cause instanceof OoxmlError) throw error()
    throw cause
  }
}

function decodePart(part: SourcePart, error: () => OoxmlError) {
  try {
    return decoder.decode(part.originalPayload)
  } catch {
    throw error()
  }
}

/**
 * The custom-properties part a package declares through `_rels/.rels`. Two
 * declarations, or one pointing at a missing or non-XML part, are ambiguous —
 * reading them would pick a winner arbitrarily, so they fail closed.
 */
function customPropertiesPart(
  relationships: readonly DocumentRelationshipWire[],
  sourceParts: ReadonlyMap<string, SourcePart>,
) {
  const declarations = relationships.filter(
    (relationship) =>
      relationship.sourcePartName === '' &&
      relationship.type === CUSTOM_PROPERTIES_RELATIONSHIP,
  )
  if (declarations.length === 0) return null
  if (declarations.length > 1) throw markingsError()
  const declaration = declarations[0]
  if (!declaration) throw markingsError()
  const target = resolveRelationshipTarget(declaration)
  if (!target) throw markingsError()
  const part = sourceParts.get(target)
  if (!part || part.kind !== 'xml') throw markingsError()
  return part
}

function storedProperties(source: string, error: () => OoxmlError) {
  const elements = parseXmlElements(source)
  const root = guardRoot(
    () => requiredRoot(elements, CUSTOM_PROPERTIES_NAMESPACE, 'Properties'),
    error,
  )
  const properties = elements
    .filter(
      (element) =>
        element.parent === root &&
        element.namespaceUri === CUSTOM_PROPERTIES_NAMESPACE &&
        element.localName === 'property',
    )
    .map((element) => {
      const name = attributeValue(element, '', 'name')
      const pid = Number(attributeValue(element, '', 'pid'))
      if (name === undefined || name === '') throw error()
      return {
        name,
        pid: Number.isInteger(pid) ? pid : 0,
        element,
      }
    })
  return { root, elements, properties }
}

/**
 * The first `vt:*` child carries a custom property's value. A property with
 * no typed value, or several, is malformed.
 */
function propertyValueChild(
  elements: readonly XmlElement[],
  property: XmlElement,
) {
  const children = elements.filter(
    (element) =>
      element.parent === property &&
      element.namespaceUri === DOC_PROPS_VT_NAMESPACE,
  )
  if (children.length !== 1) throw markingsError()
  return children[0]
}

export function readDocumentMarkings(source: {
  model: Pick<OoxmlDocument['model'], 'relationships'>
  sourceParts: ReadonlyMap<string, SourcePart>
}): DocumentMarkingsWire {
  const part = customPropertiesPart(
    source.model.relationships,
    source.sourceParts,
  )
  if (!part) return { ...EMPTY_DOCUMENT_MARKINGS }
  const xml = decodePart(part, markingsError)
  // One parse: property elements are matched to their vt: children by
  // identity, so a second parse would never match.
  const { elements, properties } = storedProperties(xml, markingsError)
  const seen = new Set<string>()
  const markings = { ...EMPTY_DOCUMENT_MARKINGS }

  for (const property of properties) {
    if (!MARKING_PROPERTY_NAMES.has(property.name)) continue
    if (seen.has(property.name)) throw markingsError()
    seen.add(property.name)
    const value = propertyValueChild(elements, property.element)
    if (!value) throw markingsError()
    const text = decodeXmlReferences(
      xml.slice(value.startTagEnd, value.endTagStart),
    )
    if (property.name === MARKING_KIND_PROPERTY) {
      if (
        value.localName !== 'lpwstr' &&
        value.localName !== 'lpstr' &&
        value.localName !== 'bstr'
      ) {
        throw markingsError()
      }
      // An empty kind is not a kind: it reads as unset rather than failing
      // the wire's min(1).
      const kind = text.trim()
      markings.documentKind = kind === '' ? null : kind
      continue
    }
    if (value.localName !== 'bool') throw markingsError()
    const flag = text.trim().toLowerCase()
    if (flag !== 'true' && flag !== 'false' && flag !== '1' && flag !== '0') {
      throw markingsError()
    }
    const key = MARKING_FLAG_KEYS.find(
      (flagKey) => MARKING_FLAG_PROPERTIES[flagKey] === property.name,
    )
    if (!key) throw markingsError()
    markings[key] = flag === 'true' || flag === '1'
  }
  return markings
}

/**
 * Rewrites the product's marking properties inside `docProps/custom.xml`,
 * creating the part, its package relationship, and its content-type override
 * when absent. Foreign properties are preserved element-for-element; the
 * part, relationship, and content-type all go through the overlay machinery,
 * so the rest of the package stays byte-identical.
 */
export function writeDocumentMarkings(
  document: OoxmlDocument,
  markings: DocumentMarkingsWire,
) {
  try {
    applyMarkings(document, markings)
  } catch (cause) {
    if (cause instanceof OoxmlError) throw cause
    throw writeError()
  }
}

function applyMarkings(
  document: OoxmlDocument,
  markings: DocumentMarkingsWire,
) {
  const part = ensureCustomPropertiesPart(document)
  // A second markings write on one parsed document must see the first write's
  // properties, not only the original XML: pending replacements are source-
  // coordinate edits invisible to the element scan, so a dirty overlay is
  // rebased onto its serialised text before this write's edits are placed.
  if (part.overlay && part.overlay.replacements.size > 0) {
    part.overlay = createXmlOverlay(serialiseOverlay(part.overlay))
  }
  const overlay = part.overlay
  if (!overlay) throw writeError()
  const { root, properties } = storedProperties(overlay.source, writeError)

  // The value elements declare their own namespace so a write survives a
  // root that does not declare `vt` — e.g. the minimal `</Properties>` part
  // this module creates or a foreign package's bare custom.xml.
  const vt = `xmlns:vt="${DOC_PROPS_VT_NAMESPACE}"`
  const wanted = new Map<string, string>()
  if (markings.documentKind !== null) {
    wanted.set(
      MARKING_KIND_PROPERTY,
      `<vt:lpwstr ${vt}>${escapeXmlText(markings.documentKind)}</vt:lpwstr>`,
    )
  }
  for (const key of MARKING_FLAG_KEYS) {
    wanted.set(
      MARKING_FLAG_PROPERTIES[key],
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
    if (!MARKING_PROPERTY_NAMES.has(property.name)) continue
    const value = wanted.get(property.name)
    // A duplicated marking name is ambiguous: the first element carries the
    // write and every later duplicate is dropped, so the serialised part
    // holds exactly one value per name.
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
    guardRoot(
      () =>
        insertRootChild(
          part,
          overlay,
          'markings:insert',
          root,
          insertions.join(''),
        ),
      writeError,
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
      existing.overlay = createXmlOverlay(decodePart(existing, writeError))
    }
    return existing
  }

  // A package may carry a file at the conventional name without the
  // relationship that declares it — an orphaned custom.xml is dead weight a
  // reader ignores, but its properties still ride every export, so dropping
  // the file would silently discard them and keeping it undeclared would
  // leave the markings unreadable. A file that is itself a valid Properties
  // part is adopted: declared, and written into with its foreign properties
  // intact. Anything else at the name is ambiguous and fails closed.
  const orphaned = document.sourceParts.get(CUSTOM_PROPERTIES_PART)
  if (orphaned) {
    if (orphaned.kind !== 'xml') throw writeError()
    if (!orphaned.overlay) {
      orphaned.overlay = createXmlOverlay(decodePart(orphaned, writeError))
    }
    storedProperties(orphaned.overlay.source, writeError)
    ensurePackageRelationship(document, CUSTOM_PROPERTIES_PART)
    guardRoot(
      () =>
        ensureContentTypeOverride(
          document,
          CUSTOM_PROPERTIES_PART,
          CUSTOM_PROPERTIES_CONTENT_TYPE,
        ),
      writeError,
    )
    return orphaned
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
  guardRoot(
    () =>
      ensureContentTypeOverride(
        document,
        CUSTOM_PROPERTIES_PART,
        CUSTOM_PROPERTIES_CONTENT_TYPE,
      ),
    writeError,
  )
  return part
}

/**
 * `_rels/.rels` analogue of `ensureDocumentRelationship` (which is scoped to
 * `word/document.xml`): adds the package-level relationship that declares
 * `partName` the custom-properties part.
 */
function ensurePackageRelationship(document: OoxmlDocument, partName: string) {
  const part = document.sourceParts.get(PACKAGE_RELATIONSHIPS_PART)
  if (!part || part.kind !== 'xml') throw writeError()
  if (!part.overlay) {
    part.overlay = createXmlOverlay(decodePart(part, writeError))
  }
  const overlay = part.overlay
  // Relationship ids added by an earlier ensure in this write live only in
  // pending replacements, so the declaration check and the id collection run
  // on the serialised current state while the insertion position comes from
  // source coordinates. A second markings write on one document must not add
  // a second declaration: two package-level custom-properties relationships
  // are the ambiguous state reads fail closed on.
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
  const root = guardRoot(
    () =>
      requiredRoot(
        parseXmlElements(overlay.source),
        RELATIONSHIPS_NAMESPACE,
        'Relationships',
      ),
    writeError,
  )
  let id = 'rIdObiterCustomProps'
  let suffix = 2
  while (ids.has(id)) {
    id = `rIdObiterCustomProps${suffix}`
    suffix += 1
  }
  guardRoot(
    () =>
      insertRootChild(
        part,
        overlay,
        'product-relationship:custom-properties',
        root,
        `<Relationship Id="${id}" Type="${CUSTOM_PROPERTIES_RELATIONSHIP}" Target="${escapeXmlAttribute(`/${partName}`)}"/>`,
      ),
    writeError,
  )
}
