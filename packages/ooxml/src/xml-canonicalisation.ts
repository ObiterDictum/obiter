import { XMLParser } from 'fast-xml-parser'

import {
  decodeXmlReferences,
  inspectXmlLexemes,
  type ProcessingInstruction,
} from './xml-lexemes'

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const ATTRIBUTE_PREFIX = '@_'

type CanonicalNode =
  | {
      kind: 'element'
      name: ExpandedName
      attributes: CanonicalAttribute[]
      children: CanonicalNode[]
    }
  | { kind: 'text'; value: string }
  | { kind: 'comment'; value: string }
  | { kind: 'processing-instruction'; target: string; data: string }

type ExpandedName = { namespaceUri: string; localName: string }
type CanonicalAttribute = ExpandedName & { value: string }
type NamespaceBindings = ReadonlyMap<string, string>

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  cdataPropName: '#cdata',
  commentPropName: '#comment',
  ignoreDeclaration: false,
  ignorePiTags: false,
})

export function canonicaliseXml(xml: string) {
  try {
    const instructions = inspectXmlLexemes(xml)
    const parsed: unknown = parser.parse(xml, true)
    if (!Array.isArray(parsed)) return undefined

    const nodes = canonicaliseNodes(
      parsed,
      new Map([['xml', XML_NAMESPACE]]),
      instructions,
    )
    if (instructions.length !== 0) return undefined

    const rootElements = nodes.filter((node) => node.kind === 'element')
    return rootElements.length === 1 ? nodes : undefined
  } catch {
    return undefined
  }
}

function canonicaliseNodes(
  values: unknown[],
  namespaces: NamespaceBindings,
  instructions: ProcessingInstruction[],
) {
  const nodes: CanonicalNode[] = []

  for (const value of values) {
    const node = canonicaliseNode(value, namespaces, instructions)
    if (!node) continue

    const previous = nodes.at(-1)
    if (node.kind === 'text' && previous?.kind === 'text')
      previous.value += node.value
    else nodes.push(node)
  }

  return nodes
}

function canonicaliseNode(
  value: unknown,
  inheritedNamespaces: NamespaceBindings,
  instructions: ProcessingInstruction[],
): CanonicalNode | undefined {
  if (!isRecord(value)) throw new Error('Unexpected XML parser output')

  const entries = Object.entries(value).filter(([key]) => key !== ':@')
  if (entries.length !== 1) throw new Error('Unexpected ordered XML node')

  const [rawName, rawValue] = entries[0]
  if (rawName === '#text') {
    if (typeof rawValue !== 'string') throw new Error('Invalid text node')
    return { kind: 'text', value: decodeXmlReferences(rawValue) }
  }
  if (rawName === '#cdata')
    return { kind: 'text', value: readSpecialNodeText(rawValue) }
  if (rawName === '#comment') {
    return { kind: 'comment', value: readSpecialNodeText(rawValue) }
  }
  if (rawName === '?xml') return undefined
  if (rawName.startsWith('?')) {
    const instruction = instructions.shift()
    if (!instruction || `?${instruction.target}` !== rawName) {
      throw new Error('Processing instruction mismatch')
    }
    return { kind: 'processing-instruction', ...instruction }
  }
  if (!Array.isArray(rawValue)) throw new Error('Invalid element children')

  const rawAttributes = readRawAttributes(value[':@'])
  const namespaces = extendNamespaces(inheritedNamespaces, rawAttributes)
  return {
    kind: 'element',
    name: resolveName(rawName, namespaces, true),
    attributes: canonicaliseAttributes(rawAttributes, namespaces),
    children: canonicaliseNodes(rawValue, namespaces, instructions),
  }
}

function canonicaliseAttributes(
  rawAttributes: ReadonlyMap<string, string>,
  namespaces: NamespaceBindings,
) {
  const attributes: CanonicalAttribute[] = []
  const identities = new Set<string>()

  for (const [rawName, rawValue] of rawAttributes) {
    if (rawName === 'xmlns' || rawName.startsWith('xmlns:')) continue

    const name = resolveName(rawName, namespaces, false)
    const identity = JSON.stringify(name)
    if (identities.has(identity))
      throw new Error('Duplicate expanded attribute')
    identities.add(identity)
    attributes.push({ ...name, value: decodeXmlReferences(rawValue) })
  }

  return attributes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
}

function extendNamespaces(
  inherited: NamespaceBindings,
  rawAttributes: ReadonlyMap<string, string>,
) {
  const namespaces = new Map(inherited)

  for (const [rawName, rawValue] of rawAttributes) {
    if (rawName === 'xmlns') {
      namespaces.set('', decodeXmlReferences(rawValue))
    } else if (rawName.startsWith('xmlns:')) {
      namespaces.set(
        rawName.slice('xmlns:'.length),
        decodeXmlReferences(rawValue),
      )
    }
  }

  return namespaces
}

function resolveName(
  qualifiedName: string,
  namespaces: NamespaceBindings,
  useDefaultNamespace: boolean,
): ExpandedName {
  const parts = qualifiedName.split(':')
  if (parts.length > 2 || parts.some((part) => part.length === 0)) {
    throw new Error('Invalid qualified name')
  }

  if (parts.length === 1) {
    return {
      namespaceUri: useDefaultNamespace ? (namespaces.get('') ?? '') : '',
      localName: parts[0],
    }
  }

  const namespaceUri = namespaces.get(parts[0])
  if (namespaceUri === undefined) throw new Error('Unbound namespace prefix')
  return { namespaceUri, localName: parts[1] }
}

function readRawAttributes(value: unknown) {
  const attributes = new Map<string, string>()
  if (value === undefined) return attributes
  if (!isRecord(value)) throw new Error('Invalid attribute collection')

  for (const [parserName, rawValue] of Object.entries(value)) {
    if (
      !parserName.startsWith(ATTRIBUTE_PREFIX) ||
      typeof rawValue !== 'string'
    ) {
      throw new Error('Invalid attribute')
    }
    attributes.set(parserName.slice(ATTRIBUTE_PREFIX.length), rawValue)
  }
  return attributes
}

function readSpecialNodeText(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('Invalid special XML node')
  }
  const text = value[0]['#text']
  if (typeof text !== 'string') throw new Error('Invalid special XML text')
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
