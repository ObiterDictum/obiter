import { XMLParser } from 'fast-xml-parser'

import { decodeXmlReferences, findXmlTagEnd } from '../xml-lexemes'
import {
  extendNamespaces,
  resolveName,
  type QualifiedAttribute,
  type XmlElement,
} from './xml-elements'

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

export type OverlayReplacement = {
  start: number
  end: number
  value: string
}
export type XmlOverlay = {
  source: string
  replacements: Map<string, OverlayReplacement>
}

type OpenElement = XmlElement & { namespaces: ReadonlyMap<string, string> }
type ParsedStartTag = {
  qualifiedName: string
  attributes: QualifiedAttribute[]
  selfClosing: boolean
}

const validationParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  cdataPropName: '#cdata',
  commentPropName: '#comment',
})

export function createXmlOverlay(source: string) {
  return { source, replacements: new Map() } satisfies XmlOverlay
}

export function parseXmlElements(source: string) {
  validationParser.parse(source, true)
  const elements: XmlElement[] = []
  const stack: OpenElement[] = []
  let cursor = 0

  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor)
    if (opening === -1) break
    if (source.startsWith('<!--', opening)) {
      cursor = closingIndex(source, '-->', opening + 4)
      continue
    }
    if (source.startsWith('<![CDATA[', opening)) {
      cursor = closingIndex(source, ']]>', opening + 9)
      continue
    }
    if (source.startsWith('<?', opening)) {
      cursor = closingIndex(source, '?>', opening + 2)
      continue
    }
    if (source.startsWith('<!', opening)) {
      throw new Error('Unsupported XML declaration')
    }

    const tagEnd = findXmlTagEnd(source, opening + 1)
    if (source.startsWith('</', opening)) {
      const qualifiedName = source.slice(opening + 2, tagEnd - 1).trim()
      const current = stack.pop()
      if (!current || current.qualifiedName !== qualifiedName) {
        throw new Error('Mismatched XML closing tag')
      }
      current.endTagStart = opening
      current.end = tagEnd
      cursor = tagEnd
      continue
    }

    const parsed = parseStartTag(source.slice(opening + 1, tagEnd - 1))
    const inherited =
      stack.at(-1)?.namespaces ?? new Map([['xml', XML_NAMESPACE]])
    const namespaces = extendNamespaces(inherited, parsed.attributes)
    const name = resolveName(parsed.qualifiedName, namespaces, true)
    const parent = stack.at(-1)
    const element: OpenElement = {
      ...name,
      qualifiedName: parsed.qualifiedName,
      start: opening,
      startTagEnd: tagEnd,
      endTagStart: tagEnd,
      end: tagEnd,
      depth: stack.length,
      selfClosing: parsed.selfClosing,
      ...(parent ? { parent } : {}),
      attributes: parsed.attributes
        .filter(({ qualifiedName }) => !isNamespaceAttribute(qualifiedName))
        .map(({ qualifiedName, value }) => ({
          ...resolveName(qualifiedName, namespaces, false),
          qualifiedName,
          value: decodeXmlReferences(value),
        })),
      namespaces,
    }
    elements.push(element)
    if (!parsed.selfClosing) stack.push(element)
    cursor = tagEnd
  }

  if (stack.length !== 0) throw new Error('Unclosed XML element')
  if (elements.filter(({ depth }) => depth === 0).length !== 1) {
    throw new Error('XML must have one root element')
  }
  return elements
}

export function elementFragment(source: string, element: XmlElement) {
  return source.slice(element.start, element.end)
}

export function setOverlayReplacement(
  overlay: XmlOverlay,
  key: string,
  replacement: OverlayReplacement,
) {
  overlay.replacements.set(key, replacement)
}

export function serialiseOverlay(overlay: XmlOverlay) {
  const replacements = [...overlay.replacements.values()].sort(
    (left, right) => left.start - right.start,
  )
  let cursor = 0
  let result = ''

  for (const replacement of replacements) {
    if (replacement.start < cursor || replacement.end < replacement.start) {
      throw new Error('Overlapping XML overlay replacements')
    }
    result += overlay.source.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
  }

  return result + overlay.source.slice(cursor)
}

export function escapeXmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function escapeXmlAttribute(value: string) {
  return escapeXmlText(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseStartTag(body: string): ParsedStartTag {
  const selfClosing = /\/\s*$/u.test(body)
  const content = selfClosing ? body.replace(/\/\s*$/u, '') : body
  let cursor = skipWhitespace(content, 0)
  const nameEnd = findNameEnd(content, cursor)
  const qualifiedName = content.slice(cursor, nameEnd)
  if (!qualifiedName) throw new Error('XML element has no name')
  cursor = nameEnd
  const attributes: ParsedStartTag['attributes'] = []

  while (cursor < content.length) {
    cursor = skipWhitespace(content, cursor)
    if (cursor === content.length) break
    const attributeEnd = findAttributeNameEnd(content, cursor)
    const attributeName = content.slice(cursor, attributeEnd)
    cursor = skipWhitespace(content, attributeEnd)
    if (!attributeName || content[cursor] !== '=') {
      throw new Error('Malformed XML attribute')
    }
    cursor = skipWhitespace(content, cursor + 1)
    const quote = content[cursor]
    if (quote !== '"' && quote !== "'")
      throw new Error('Unquoted XML attribute')
    const valueEnd = content.indexOf(quote, cursor + 1)
    if (valueEnd === -1) throw new Error('Unclosed XML attribute')
    attributes.push({
      qualifiedName: attributeName,
      value: content.slice(cursor + 1, valueEnd),
    })
    cursor = valueEnd + 1
  }

  return { qualifiedName, attributes, selfClosing }
}

function isNamespaceAttribute(name: string) {
  return name === 'xmlns' || name.startsWith('xmlns:')
}

function closingIndex(source: string, marker: string, start: number) {
  const index = source.indexOf(marker, start)
  if (index === -1) throw new Error('Unclosed XML construct')
  return index + marker.length
}

function skipWhitespace(value: string, start: number) {
  let cursor = start
  while (/\s/u.test(value[cursor] ?? '')) cursor += 1
  return cursor
}

function findNameEnd(value: string, start: number) {
  let cursor = start
  while (cursor < value.length && !/\s|\//u.test(value[cursor])) cursor += 1
  return cursor
}

function findAttributeNameEnd(value: string, start: number) {
  let cursor = start
  while (cursor < value.length && !/\s|=/u.test(value[cursor])) cursor += 1
  return cursor
}
