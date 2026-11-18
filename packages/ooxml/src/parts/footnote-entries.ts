import type { DocumentStoryWire } from '@obiter/contracts'
import type { ParagraphAnchor } from '../model'
import type { PartIndex } from './story-index'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'

const containers = new Set([
  'p',
  'hyperlink',
  'r',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
])
const leaves = new Set([
  'pPr',
  'rPr',
  't',
  'delText',
  'tab',
  'br',
  'cr',
  'footnoteRef',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
])

function supportedContent(index: PartIndex, node: XmlElement): boolean {
  return index
    .childrenOf(node)
    .every(
      (child) =>
        child.namespaceUri === WORD_NAMESPACE &&
        (leaves.has(child.localName) ||
          (containers.has(child.localName) && supportedContent(index, child))),
    )
}

export function footnoteEntries(
  index: PartIndex,
  paragraphs: readonly ParagraphAnchor[],
): NonNullable<DocumentStoryWire['footnoteEntries']> {
  const root = index.root()
  if (!root) return []
  const entries: NonNullable<DocumentStoryWire['footnoteEntries']> = []
  let cursor = 0
  for (const element of index.childrenOf(root)) {
    if (!isWord(element, 'footnote')) continue
    while (
      (paragraphs[cursor]?.paragraphRange.start ?? Infinity) < element.start
    )
      cursor++
    const paragraphIds: string[] = []
    while (
      (paragraphs[cursor]?.paragraphRange.start ?? Infinity) < element.end
    ) {
      const paragraph = paragraphs[cursor++]
      if (paragraph) paragraphIds.push(paragraph.wire.id)
    }
    const id = attributeValue(element, WORD_NAMESPACE, 'id')
    const type = attributeValue(element, WORD_NAMESPACE, 'type')
    if (id === undefined || (type && type !== 'normal')) continue
    const readOnly =
      !paragraphIds.length ||
      !index
        .childrenOf(element)
        .every((child) => isWord(child, 'p') && supportedContent(index, child))
    entries.push({ id, paragraphIds, ...(readOnly ? { readOnly } : {}) })
  }
  return entries
}
