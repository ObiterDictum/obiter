import {
  EMPTY_DOCUMENT_MARKINGS,
  type DocumentMarkingsState,
  type DocumentRelationshipWire,
} from '@obiter/contracts'

import { requiredRoot } from '../comments-package-parts'
import { OoxmlError, type OoxmlDocument, type SourcePart } from '../model'
import { decodeXmlReferences } from '../xml-lexemes'
import { parseXmlElements } from './overlay'
import { resolveRelationshipTarget } from './rels'
import { attributeValue, type XmlElement } from './xml-elements'

export const CUSTOM_PROPERTIES_PART = 'docProps/custom.xml'
export const CUSTOM_PROPERTIES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'
export const CUSTOM_PROPERTIES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml'
export const CUSTOM_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
export const DOC_PROPS_VT_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'

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

/**
 * The markings allow-list the share-safe export retains. Every other
 * property — including unknown `obiter.*` names a newer build may have
 * written — is dropped from the copy: a name this build does not own cannot
 * be proven safe, and keeping it verbatim would smuggle arbitrary payload.
 */
export const MARKING_PROPERTY_TYPES = {
  [MARKING_KIND_PROPERTY]: 'string',
  [MARKING_FLAG_PROPERTIES.draft]: 'bool',
  [MARKING_FLAG_PROPERTIES.privileged]: 'bool',
  [MARKING_FLAG_PROPERTIES.withoutPrejudice]: 'bool',
} as const

/** The marking property names and value tags, shared with the write path. */
export const MARKING_PROPERTIES = {
  kind: MARKING_KIND_PROPERTY,
  flags: MARKING_FLAG_PROPERTIES,
  flagKeys: MARKING_FLAG_KEYS,
  names: MARKING_PROPERTY_NAMES,
} as const

const decoder = new TextDecoder('utf-8', { fatal: true })

function markingsError(): OoxmlError {
  return new OoxmlError('invalid-xml-part')
}

export function markingsWriteError(): OoxmlError {
  return new OoxmlError('invalid-document-edit')
}

/**
 * The shared comments-package helpers report every structural failure as
 * `comment-export-failed`. In this part that code would mislabel a markings
 * problem, so the calls run inside the narrowest conversion the error type
 * allows.
 */
export function guardMarkingsRoot<T>(
  make: () => T,
  error: () => OoxmlError,
): T {
  try {
    return make()
  } catch (cause) {
    if (cause instanceof OoxmlError) throw error()
    throw cause
  }
}

export function decodeCustomPropertiesPart(
  part: SourcePart,
  error: () => OoxmlError,
) {
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
export function customPropertiesPart(
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

export function storedCustomProperties(
  source: string,
  error: () => OoxmlError,
) {
  const elements = parseXmlElements(source)
  const root = guardMarkingsRoot(
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

/**
 * Reads the product markings the custom properties part carries. A package
 * without the part — or one that declares it at a nonstandard target — reads
 * as unmarked; foreign properties never contribute to markings. A part that
 * exists but cannot be read honestly — malformed XML, a duplicated or
 * mistyped product property, competing declarations — degrades to
 * `unreadable` rather than breaking the open path: opening a document must
 * not fail on markings state the user never wrote. Writes still fail closed
 * on the same input.
 */
export function readDocumentMarkings(source: {
  model: Pick<OoxmlDocument['model'], 'relationships'>
  sourceParts: ReadonlyMap<string, SourcePart>
}): DocumentMarkingsState {
  const unreadable: DocumentMarkingsState = {
    ...EMPTY_DOCUMENT_MARKINGS,
    unreadable: true,
  }
  let part: SourcePart | null
  try {
    part = customPropertiesPart(source.model.relationships, source.sourceParts)
  } catch {
    return unreadable
  }
  if (!part) return { ...EMPTY_DOCUMENT_MARKINGS }

  // One parse: property elements are matched to their vt: children by
  // identity, so a second parse would never match. The read walks the
  // property elements directly rather than through `storedCustomProperties` —
  // that helper insists every property be named, while a nameless *foreign*
  // property is not a marking this build wrote and must not flip the
  // unreadable flag.
  let xml: string
  let elements: XmlElement[]
  let root: XmlElement
  try {
    xml = decodeCustomPropertiesPart(part, markingsError)
    elements = parseXmlElements(xml)
    root = requiredRoot(elements, CUSTOM_PROPERTIES_NAMESPACE, 'Properties')
  } catch {
    return unreadable
  }
  const properties = elements.filter(
    (element) =>
      element.parent === root &&
      element.namespaceUri === CUSTOM_PROPERTIES_NAMESPACE &&
      element.localName === 'property',
  )
  const seen = new Set<string>()
  const markings = { ...EMPTY_DOCUMENT_MARKINGS }

  for (const element of properties) {
    const name = attributeValue(element, '', 'name')
    if (name === undefined || !MARKING_PROPERTY_NAMES.has(name)) continue
    if (seen.has(name)) return unreadable
    seen.add(name)
    let value: XmlElement | undefined
    try {
      value = propertyValueChild(elements, element)
    } catch {
      return unreadable
    }
    if (!value) return unreadable
    const text = decodeXmlReferences(
      xml.slice(value.startTagEnd, value.endTagStart),
    )
    if (name === MARKING_KIND_PROPERTY) {
      if (
        value.localName !== 'lpwstr' &&
        value.localName !== 'lpstr' &&
        value.localName !== 'bstr'
      ) {
        return unreadable
      }
      // An empty kind is not a kind: it reads as unset rather than failing
      // the wire's min(1).
      const kind = text.trim()
      markings.documentKind = kind === '' ? null : kind
      continue
    }
    if (value.localName !== 'bool') return unreadable
    const flag = text.trim().toLowerCase()
    if (flag !== 'true' && flag !== 'false' && flag !== '1' && flag !== '0') {
      return unreadable
    }
    const key = MARKING_FLAG_KEYS.find(
      (flagKey) => MARKING_FLAG_PROPERTIES[flagKey] === name,
    )
    if (!key) return unreadable
    markings[key] = flag === 'true' || flag === '1'
  }
  return markings
}
