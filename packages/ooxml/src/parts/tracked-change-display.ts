import type { DocumentChangeWire } from '@obiter/contracts'
import { decodeXmlReferences } from '../xml-lexemes'
import { runHyperlinkTarget } from './hyperlink-target'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'

type Segment = NonNullable<
  NonNullable<DocumentChangeWire['inlinePosition']>['segments']
>[number]

export function trackedElementText(source: string, element: XmlElement) {
  if (isWord(element, 'tab')) return '\t'
  if (isWord(element, 'cr')) return '\n'
  if (isWord(element, 'br')) {
    const type = attributeValue(element, WORD_NAMESPACE, 'type')
    return type === 'page' ? '\f' : type === 'column' ? '\v' : '\n'
  }
  return element.selfClosing
    ? ''
    : decodeXmlReferences(
        source.slice(element.startTagEnd, element.endTagStart),
      )
}

/** Visit each opaque wrapper once; the review engine still lists only the outer change. */
export function trackedDisplaySegments(
  source: string,
  root: XmlElement,
  childrenOf: (element: XmlElement) => readonly XmlElement[],
  hyperlinkTargets?: ReadonlyMap<string, string>,
): Segment[] {
  const segments: Segment[] = []
  const stack: Array<{
    element: XmlElement
    deleted: boolean
    author: string | undefined
  }> = [{ element: root, deleted: false, author: undefined }]
  while (stack.length) {
    const item = stack.pop()
    if (!item) break
    const { element } = item
    const deleted =
      isWord(element, 'del') || isWord(element, 'moveFrom')
        ? true
        : isWord(element, 'ins') || isWord(element, 'moveTo')
          ? false
          : item.deleted
    const author =
      attributeValue(element, WORD_NAMESPACE, 'author') ?? item.author
    if (
      isWord(element, 't') ||
      isWord(element, 'delText') ||
      isWord(element, 'tab') ||
      isWord(element, 'br') ||
      isWord(element, 'cr')
    ) {
      const text = trackedElementText(source, element)
      const hyperlinkTarget = runHyperlinkTarget(element, hyperlinkTargets)
      const previous = segments.at(-1)
      if (
        previous &&
        previous.deleted === deleted &&
        previous.author === author &&
        previous.hyperlinkTarget === hyperlinkTarget
      )
        previous.text += text
      else
        segments.push({
          text,
          deleted,
          ...(author === undefined ? {} : { author }),
          ...(hyperlinkTarget ? { hyperlinkTarget } : {}),
        })
    }
    const children = childrenOf(element)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child) stack.push({ element: child, deleted, author })
    }
  }
  return segments
}
