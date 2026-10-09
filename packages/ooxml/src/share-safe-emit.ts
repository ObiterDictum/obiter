import type { SourcePart } from './model'
import { escapeXmlAttribute, escapeXmlText } from './parts/overlay'
import type { XmlAttribute, XmlElement } from './parts/xml-elements'
import { decodeXmlReferences, findXmlTagEnd } from './xml-lexemes'
import {
  CANONICAL_NAMESPACE_PREFIXES,
  IGNORABLE_NAMESPACES,
  MARKUP_COMPAT_NAMESPACE,
  XML_NAMESPACE_URI,
  type ShareSafeContentPlan,
} from './share-safe-parts'
import { shareSafeAttributeVerdict } from './share-safe-policy'
import { refuseShareSafe } from './share-safe-refusal'

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
/**
 * XML 1.0 legality: control codes below 0x20 except tab, LF and CR are
 * not legal characters, and a text node carrying one cannot emit.
 */
function carriesControlCharacter(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true
    }
  }
  return false
}

/**
 * The canonical serialiser: a kept part's output is written from the
 * parsed element tree and the content plan, never spliced from input
 * bytes. Comments, processing instructions, CDATA wrappers, unused
 * `xmlns` declarations and `mc:` attributes cannot reach the output
 * because nothing here reads the source as markup — the source only
 * supplies text content between element boundaries.
 *
 * Namespaces are redeclared from scratch: every emitted element and
 * attribute spells the canonical prefix for its expanded namespace, the
 * root declares exactly the namespaces the emitted surface uses, and
 * `mc:Ignorable` is generated only when a kept element needs it.
 */
export function emitShareSafePart(
  part: SourcePart,
  contentPlan: ShareSafeContentPlan,
) {
  const overlay = part.overlay
  if (!overlay) {
    refuseShareSafe('malformed-package', `${part.name} has no parse surface`)
  }
  const source = overlay.source
  const elements = contentPlan.elements
  const root = elements.find((element) => element.depth === 0)
  if (!root || contentPlan.removed.has(root)) {
    refuseShareSafe('malformed-package', `${part.name} has no root to emit`)
  }

  const gone = (element: XmlElement) => {
    let cursor: XmlElement | undefined = element
    while (cursor) {
      if (contentPlan.removed.has(cursor)) return true
      cursor = cursor.parent
    }
    return false
  }
  const childrenOf = new Map<XmlElement, XmlElement[]>()
  for (const element of elements) {
    if (element.parent === undefined) continue
    const siblings = childrenOf.get(element.parent) ?? []
    siblings.push(element)
    childrenOf.set(element.parent, siblings)
  }

  // The namespaces the emitted surface actually uses — element names and
  // surviving attribute names only.
  const usedNamespaces = new Set<string>()
  for (const element of elements) {
    if (gone(element) || contentPlan.unwrapped.has(element)) continue
    if (element.namespaceUri === MARKUP_COMPAT_NAMESPACE) continue
    usedNamespaces.add(element.namespaceUri)
    for (const attribute of element.attributes) {
      if (!emittedAttribute(element, attribute, contentPlan)) continue
      if (attribute.namespaceUri !== '') {
        usedNamespaces.add(attribute.namespaceUri)
      }
    }
  }
  const ignorable = [...usedNamespaces].filter((uri) =>
    IGNORABLE_NAMESPACES.has(uri),
  )
  if (ignorable.length > 0) usedNamespaces.add(MARKUP_COMPAT_NAMESPACE)

  const declarations = [...usedNamespaces]
    .filter((uri) => uri !== XML_NAMESPACE_URI)
    .map((uri) => {
      const prefix = CANONICAL_NAMESPACE_PREFIXES.get(uri)
      if (prefix === undefined) {
        refuseShareSafe(
          'unverifiable-output',
          `${part.name} needs a namespace ${uri} with no canonical prefix`,
        )
      }
      return prefix === '' ? `xmlns="${uri}"` : `xmlns:${prefix}="${uri}"`
    })
    .sort()

  const rendered = emitElement(root, true)
  return XML_DECLARATION + rendered

  function canonicalName(namespaceUri: string, localName: string) {
    if (namespaceUri === '') return localName
    const prefix = CANONICAL_NAMESPACE_PREFIXES.get(namespaceUri)
    if (prefix === undefined) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits ${localName} in a namespace with no canonical prefix`,
      )
    }
    return prefix === '' ? localName : `${prefix}:${localName}`
  }

  function emitElement(element: XmlElement, isRoot: boolean): string {
    const name = canonicalName(element.namespaceUri, element.localName)
    const seen = new Set<string>()
    let attributes = ''
    for (const attribute of element.attributes) {
      if (!emittedAttribute(element, attribute, contentPlan)) continue
      const key = `${attribute.namespaceUri}${attribute.localName}`
      if (seen.has(key)) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries a duplicated attribute on ${element.qualifiedName}`,
        )
      }
      seen.add(key)
      const override = contentPlan.attrOverrides.get(attribute)
      const value = override === undefined ? attribute.value : override
      attributes += ` ${canonicalName(attribute.namespaceUri, attribute.localName)}="${escapeXmlAttribute(value)}"`
    }
    if (isRoot) {
      for (const declaration of declarations) attributes += ` ${declaration}`
      if (ignorable.length > 0) {
        const tokens = ignorable
          .map((uri) => CANONICAL_NAMESPACE_PREFIXES.get(uri)!)
          .join(' ')
        attributes += ` mc:Ignorable="${tokens}"`
      }
    }
    const override = contentPlan.textOverrides.get(element)
    if (override !== undefined) {
      return `<${name}${attributes}>${escapeXmlText(override)}</${name}>`
    }
    if (element.selfClosing || element.endTagStart <= element.startTagEnd) {
      return `<${name}${attributes}/>`
    }
    const inner = emitChildren(element)
    if (inner === '') return `<${name}${attributes}/>`
    return `<${name}${attributes}>${inner}</${name}>`
  }

  function emitChildren(element: XmlElement) {
    const children = childrenOf.get(element) ?? []
    let output = ''
    let cursor = element.startTagEnd
    for (const child of children) {
      output += emitText(cursor, child.start)
      cursor = child.end
      if (gone(child)) continue
      output += emitElementOrChildren(child)
    }
    output += emitText(cursor, element.endTagStart)
    return output
  }

  function emitElementOrChildren(element: XmlElement): string {
    if (contentPlan.unwrapped.has(element)) {
      return element.selfClosing ? '' : emitChildren(element)
    }
    return emitElement(element, false)
  }

  /**
   * Text between two element boundaries: comments and processing
   * instructions drop, CDATA contributes its literal text, and the rest
   * decodes entity references then re-escapes — so `&amp;` spells and
   * raw bytes both arrive as one canonical text form.
   */
  function emitText(start: number, end: number) {
    let output = ''
    let cursor = start
    while (cursor < end) {
      const opening = source.indexOf('<', cursor)
      if (opening === -1 || opening >= end) {
        output += emitTextChunk(source.slice(cursor, end))
        break
      }
      output += emitTextChunk(source.slice(cursor, opening))
      if (source.startsWith('<!--', opening)) {
        const close = source.indexOf('-->', opening + 4)
        cursor = close === -1 ? end : Math.min(close + 3, end)
        continue
      }
      if (source.startsWith('<![CDATA[', opening)) {
        const close = source.indexOf(']]>', opening + 9)
        if (close === -1 || close > end) {
          refuseShareSafe(
            'malformed-package',
            `${part.name} carries an unclosed CDATA section`,
          )
        }
        // CDATA content is literal: no reference decoding — `&#60;` inside
        // a section is the characters, not a `<`.
        const literal = source.slice(opening + 9, close)
        if (carriesControlCharacter(literal)) {
          refuseShareSafe(
            'malformed-package',
            `${part.name} carries a control character in text`,
          )
        }
        output += escapeXmlText(literal)
        cursor = close + 3
        continue
      }
      if (source.startsWith('<?', opening)) {
        const close = source.indexOf('?>', opening + 2)
        cursor = close === -1 ? end : Math.min(close + 2, end)
        continue
      }
      if (source.startsWith('<!', opening)) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries a declaration inside content`,
        )
      }
      // Any element tag inside a text gap belongs to a node the element
      // walk already consumed — encountering one is an emitter bug.
      let tagEnd: number
      try {
        tagEnd = findXmlTagEnd(source, opening + 1)
      } catch {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries an unterminated tag`,
        )
      }
      if (tagEnd > end) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries an unterminated tag`,
        )
      }
      cursor = tagEnd
    }
    return output
  }

  function emitTextChunk(fragment: string) {
    if (fragment === '') return ''
    let decoded: string
    try {
      decoded = decodeXmlReferences(fragment)
    } catch {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries an unsupported entity reference`,
      )
    }
    if (carriesControlCharacter(decoded)) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries a control character in text`,
      )
    }
    return escapeXmlText(decoded)
  }
}

/**
 * Whether an attribute emits: keep and relationship-pointer verdicts emit
 * (the latter only after the analysis resolved it), strips and refuse
 * classes never do. An override of `undefined` drops the attribute — a
 * dangling bookmark anchor loses its pointer rather than a dead name.
 */
function emittedAttribute(
  element: XmlElement,
  attribute: XmlAttribute,
  contentPlan: ShareSafeContentPlan,
) {
  const override = contentPlan.attrOverrides.get(attribute)
  if (override === undefined && contentPlan.attrOverrides.has(attribute)) {
    return false
  }
  const verdict = shareSafeAttributeVerdict(element, attribute)
  return verdict === 'keep' || verdict === 'relationship-pointer'
}
