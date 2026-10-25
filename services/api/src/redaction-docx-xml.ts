import JSZip from 'jszip'
import { MC } from './redaction-docx-map'
import {
  decodeXmlReferences,
  isWord,
  loadOoxmlZipEntries,
  parseXmlElements,
  type XmlElement,
} from '@obiter/ooxml'

/** Fallback text boxes duplicate the modern drawing but escape model anchors. */
export async function prepareDocxForBurn(bytes: Buffer) {
  // Enforce package expansion limits before JSZip or XML parsing touches data.
  const entries = await loadOoxmlZipEntries(bytes)
  const zip = new JSZip()
  for (const [name, payload] of entries) zip.file(name, payload)
  for (const file of Object.values(zip.files)) {
    if (
      file.dir ||
      !/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/iu.test(
        file.name,
      )
    )
      continue
    const source = await file.async('string')
    const elements = parseXmlElements(source)
    const childrenByParent = new Map<number, typeof elements>()
    for (const element of elements) {
      if (!element.parent) continue
      const children = childrenByParent.get(element.parent.start) ?? []
      children.push(element)
      childrenByParent.set(element.parent.start, children)
    }
    const replacements: Array<{ start: number; end: number; value: string }> =
      []
    for (const element of elements) {
      if (
        element.namespaceUri !== MC ||
        element.localName !== 'AlternateContent' ||
        !element.parent ||
        !isWord(element.parent, 'r')
      )
        continue
      const branch =
        (childrenByParent.get(element.start) ?? []).find(
          (child) => child.localName === 'Choice',
        ) ??
        (childrenByParent.get(element.start) ?? []).find(
          (child) => child.localName === 'Fallback',
        )
      if (!branch) throw new Error('Alternate content has no burnable branch.')
      const children = childrenByParent.get(branch.start) ?? []
      if (
        children.some(
          (child) =>
            ![
              't',
              'tab',
              'br',
              'cr',
              'noBreakHyphen',
              'softHyphen',
              'sym',
            ].some((name) => isWord(child, name)),
        )
      )
        continue
      for (const child of children) {
        const prefix = child.qualifiedName.split(':')[0] ?? ''
        if (
          child.namespaces?.get(prefix) !==
          element.parent.namespaces?.get(prefix)
        )
          throw new Error('Unsupported alternate run namespace.')
      }
      replacements.push({
        ...element,
        value: source.slice(branch.startTagEnd, branch.endTagStart),
      })
    }
    // Word's modern Choice is the canonical reviewed representation. Its
    // legacy duplicate must not survive elsewhere in the package.
    replacements.push(
      ...elements
        .filter(
          (element) =>
            element.namespaceUri === MC &&
            element.localName === 'Fallback' &&
            (childrenByParent.get(element.parent?.start ?? -1) ?? []).some(
              (sibling) => sibling.localName === 'Choice',
            ),
        )
        .map((element) => ({ ...element, value: '' })),
    )
    replacements.sort((a, b) => a.start - b.start || b.end - a.end)
    // Outermost removals also consume any nested fallback.
    let result = ''
    let cursor = 0
    for (const element of replacements) {
      if (element.start < cursor) continue
      result += source.slice(cursor, element.start) + element.value
      cursor = element.end
    }
    if (cursor) zip.file(file.name, result + source.slice(cursor))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/** Decode attributes and mixed text, both with and without layout separators. */
export function decodedXmlText(
  source: string,
  includeAttribute: (
    element: XmlElement,
    attribute: XmlElement['attributes'][number],
  ) => boolean = () => true,
) {
  const elements = parseXmlElements(source)
  const tags = elements
    .flatMap((element) => [
      {
        element,
        closing: false,
        start: element.start,
        end: element.startTagEnd,
        separator: isWord(element, 'tab')
          ? '\t'
          : isWord(element, 'br')
            ? '\n'
            : '',
      },
      ...(!element.selfClosing
        ? [
            {
              element,
              closing: true,
              start: element.endTagStart,
              end: element.end,
              separator: element.localName === 'p' ? '\n' : '',
            },
          ]
        : []),
    ])
    .sort((a, b) => a.start - b.start)
  const parents = new Set(elements.map((element) => element.parent))
  const stack: typeof elements = []
  let cursor = 0
  let text = ''
  let layoutText = ''
  let bodyText = ''
  for (const tag of tags) {
    // The complete part has already passed XML validation. Read its text
    // segments without treating markup removal as a string sanitiser. CDATA
    // is literal; entity references are decoded only in ordinary XML text.
    const segments = source
      .slice(cursor, tag.start)
      .matchAll(/<!--[^]*?-->|<\?[^]*?\?>|<!\[CDATA\[([^]*?)\]\]>|([^<]+)/gu)
    const content = [...segments]
      .map((segment) => segment[1] ?? decodeXmlReferences(segment[2] ?? ''))
      .join('')
    // Indentation between elements is not rendered text. Preserve whitespace
    // inside text carriers, including a run containing only a space.
    const meaningful =
      content.trim() || !parents.has(stack.at(-1)) ? content : ''
    text += meaningful
    layoutText += meaningful + tag.separator
    bodyText +=
      meaningful +
      (tag.closing && tag.element.localName === 'p' ? '\n\n' : tag.separator)
    if (tag.closing) stack.pop()
    else if (!tag.element.selfClosing) stack.push(tag.element)
    cursor = tag.end
  }
  const attributes = elements.flatMap((element) =>
    element.attributes
      .filter((attribute) => includeAttribute(element, attribute))
      .map((attribute) => attribute.value),
  )
  const hiddenMarkup = [...source.matchAll(/<!--([^]*?)-->|<\?([^]*?)\?>/gu)]
    .filter((match) => !/^xml(?:\s|$)/iu.test(match[2] ?? ''))
    .map((match) => match[1] ?? match[2] ?? '')
  return [text, layoutText, bodyText, ...attributes, ...hiddenMarkup]
}
