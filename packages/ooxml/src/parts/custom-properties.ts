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

export const MARKING_PROPERTY_TYPES = {
  [MARKING_KIND_PROPERTY]: 'string',
  [MARKING_FLAG_PROPERTIES.draft]: 'bool',
  [MARKING_FLAG_PROPERTIES.privileged]: 'bool',
  [MARKING_FLAG_PROPERTIES.withoutPrejudice]: 'bool',
} as const

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
