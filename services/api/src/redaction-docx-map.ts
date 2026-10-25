import { hex } from 'dingbat-to-unicode'
import { RedactionDocxBurnError } from './redaction-docx-error'
import {
  attributeValue,
  decodeXmlReferences,
  isWord,
  parseXmlElements,
  WORD_NAMESPACE,
  type XmlElement,
} from '@obiter/ooxml'

export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
export type MappedDocxNode = {
  partName: string
  range: XmlElement
  run: XmlElement
  text: string
  start: number
  end: number
}

/** One coordinate system for review and burn. Offsets are UTF-16, like JS slices.
 * Paragraphs contribute two newlines, breaks one, tabs one. No Unicode folding.
 * Choice is Word's live shape; Fallback is a duplicate, never a second occurrence.
 * Deleted text and comments are included so a reviewer can explicitly select them.
 */
export function mapDocxText(entries: ReadonlyMap<string, Uint8Array>) {
  const nodes: MappedDocxNode[] = []
  let text = ''
  const names = [...entries.keys()].filter((name) =>
    /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/iu.test(
      name,
    ),
  )
  const rank = (name: string) =>
    name.includes('header')
      ? 0
      : name === 'word/document.xml'
        ? 1
        : name.includes('footer')
          ? 2
          : 3
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  for (const partName of names) {
    const payload = entries.get(partName)
    if (!payload) continue
    const source = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    const elements = parseXmlElements(source)
    const excluded = new Set<XmlElement>()
    const runs = new Map<XmlElement, XmlElement>()
    const events: Array<{ at: number; element?: XmlElement; value?: string }> =
      []
    for (const element of elements) {
      const parent = element.parent
      if (
        (parent && excluded.has(parent)) ||
        (element.namespaceUri === MC && element.localName === 'Fallback') ||
        (['footnote', 'endnote'].some((name) => isWord(element, name)) &&
          attributeValue(element, WORD_NAMESPACE, 'type') !== undefined)
      ) {
        excluded.add(element)
        continue
      }
      const run = isWord(element, 'r') ? element : parent && runs.get(parent)
      if (run) runs.set(element, run)
      if (isWord(element, 'del') || isWord(element, 'moveFrom')) {
        events.push({ at: element.start, value: '\n\n[Deleted text]\n\n' })
        events.push({ at: element.end, value: '\n\n[End deleted text]\n\n' })
      }
      if (isWord(element, 'p')) events.push({ at: element.end, value: '\n\n' })
      if (
        ['footnote', 'endnote', 'comment'].some((name) => isWord(element, name))
      ) {
        const label =
          element.localName[0]?.toUpperCase() + element.localName.slice(1)
        events.push({
          at: element.start,
          value: `[${label} ${attributeValue(element, WORD_NAMESPACE, 'id') ?? '?'}] `,
        })
      }
      if (run && nodeText(element, source) !== undefined)
        events.push({ at: element.start, element })
    }
    events.sort((a, b) => a.at - b.at)
    for (const event of events) {
      if (event.element) {
        const run = runs.get(event.element)
        if (!run) continue
        const value = nodeText(event.element, source) ?? ''
        nodes.push({
          partName,
          range: event.element,
          run,
          text: value,
          start: text.length,
          end: text.length + value.length,
        })
        text += value
      } else text += event.value ?? ''
    }
  }
  // Leading/trailing layout whitespace is not review content. Adjust every
  // coordinate rather than searching for the trimmed text in the document.
  const leading = text.length - text.trimStart().length
  text = text.trim()
  for (const node of nodes) {
    node.start -= leading
    node.end -= leading
  }
  return { text, nodes }
}

export function nodeText(
  element: XmlElement,
  source: string,
): string | undefined {
  if (isWord(element, 't') || isWord(element, 'delText')) {
    const inner = source.slice(element.startTagEnd, element.endTagStart)
    const segments = [
      ...inner.matchAll(
        /<!\[CDATA\[([^]*?)\]\]>|<!--[^]*?-->|<\?[^]*?\?>|([^<]+)/gu,
      ),
    ]
    if (segments.map((segment) => segment[0]).join('') !== inner)
      throw new RedactionDocxBurnError(
        'Unsupported nested markup in a Word text carrier.',
      )
    return segments
      .map((segment) => segment[1] ?? decodeXmlReferences(segment[2] ?? ''))
      .join('')
  }
  if (isWord(element, 'tab')) return '\t'
  if (isWord(element, 'br') || isWord(element, 'cr')) return '\n'
  if (isWord(element, 'noBreakHyphen')) return '\u2011'
  if (isWord(element, 'softHyphen')) return '\u00ad'
  if (isWord(element, 'sym')) {
    const font = attributeValue(element, WORD_NAMESPACE, 'font') ?? ''
    const char = attributeValue(element, WORD_NAMESPACE, 'char') ?? ''
    const mapped =
      hex(font, char) ??
      (/^F0../iu.test(char) ? hex(font, char.slice(2)) : undefined)
    if (!mapped)
      throw new RedactionDocxBurnError(
        'A symbol uses an unsupported font or character; its extraction coordinates cannot be proved.',
      )
    return mapped.string
  }
  return undefined
}

/** Preserve XML annotations separately from the reviewable character data. */
export function hiddenXmlMarkup(inner: string) {
  return [...inner.matchAll(/<!\[CDATA\[[^]*?\]\]>|<!--[^]*?-->|<\?[^]*?\?>/gu)]
    .filter((segment) => !segment[0].startsWith('<![CDATA['))
    .map((segment) => segment[0])
    .join('')
}
