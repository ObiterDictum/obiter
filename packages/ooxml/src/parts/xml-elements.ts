import { decodeXmlReferences } from '../xml-lexemes'

export const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export type ExpandedName = { namespaceUri: string; localName: string }
export type QualifiedAttribute = { qualifiedName: string; value: string }
export type XmlAttribute = ExpandedName & QualifiedAttribute
export type XmlElement = ExpandedName & {
  qualifiedName: string
  start: number
  startTagEnd: number
  endTagStart: number
  end: number
  depth: number
  selfClosing: boolean
  parent?: XmlElement
  attributes: XmlAttribute[]
}

export function extendNamespaces(
  inherited: ReadonlyMap<string, string>,
  attributes: Iterable<QualifiedAttribute>,
) {
  const namespaces = new Map(inherited)

  for (const attribute of attributes) {
    if (attribute.qualifiedName === 'xmlns') {
      namespaces.set('', decodeXmlReferences(attribute.value))
    } else if (attribute.qualifiedName.startsWith('xmlns:')) {
      namespaces.set(
        attribute.qualifiedName.slice('xmlns:'.length),
        decodeXmlReferences(attribute.value),
      )
    }
  }

  return namespaces
}

export function resolveName(
  qualifiedName: string,
  namespaces: ReadonlyMap<string, string>,
  useDefaultNamespace: boolean,
): ExpandedName {
  const parts = qualifiedName.split(':')
  if (parts.length > 2 || parts.some((part) => part.length === 0)) {
    throw new Error('Invalid XML qualified name')
  }

  if (parts.length === 1) {
    return {
      namespaceUri: useDefaultNamespace ? (namespaces.get('') ?? '') : '',
      localName: parts[0],
    }
  }

  const namespaceUri = namespaces.get(parts[0])
  if (namespaceUri === undefined) {
    throw new Error('Unbound XML namespace prefix')
  }
  return { namespaceUri, localName: parts[1] }
}

export function attributeValue(
  element: XmlElement,
  namespaceUri: string,
  localName: string,
) {
  return element.attributes.find(
    (attribute) =>
      attribute.namespaceUri === namespaceUri &&
      attribute.localName === localName,
  )?.value
}

export function isWord(element: XmlElement, localName: string) {
  return (
    element.namespaceUri === WORD_NAMESPACE && element.localName === localName
  )
}

export function isDescendantOf(element: XmlElement, ancestor: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (parent === ancestor) return true
    parent = parent.parent
  }
  return false
}

export function childValue(
  elements: readonly XmlElement[],
  parent: XmlElement,
  name: string,
) {
  const child = elements.find(
    (element) => element.parent === parent && isWord(element, name),
  )
  return child ? attributeValue(child, WORD_NAMESPACE, 'val') : undefined
}

export function requiredAttribute(
  element: XmlElement,
  localName: string,
  subject: string,
) {
  const value = attributeValue(element, '', localName)
  if (!value) throw new Error(`${subject} is missing an attribute`)
  return value
}
