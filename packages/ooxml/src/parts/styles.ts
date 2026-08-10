import type { DocumentStyleWire } from '@obiter/contracts'

import {
  attributeValue,
  elementFragment,
  parseXmlElements,
  type XmlElement,
} from './overlay'

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export function parseStyles(source: string) {
  const elements = parseXmlElements(source)
  const styles: DocumentStyleWire[] = []

  for (const style of elements.filter((element) => isWord(element, 'style'))) {
    const styleId = attributeValue(style, WORD_NAMESPACE, 'styleId')
    if (!styleId) continue
    const basedOnStyleId = childValue(elements, style, 'basedOn')
    const linkedStyleId = childValue(elements, style, 'link')
    styles.push({
      styleId,
      ...(basedOnStyleId ? { basedOnStyleId } : {}),
      ...(linkedStyleId ? { linkedStyleId } : {}),
      sourceFragment: elementFragment(source, style),
    })
  }

  return styles
}

function childValue(elements: XmlElement[], parent: XmlElement, name: string) {
  const child = elements.find(
    (element) => element.parent === parent && isWord(element, name),
  )
  return child ? attributeValue(child, WORD_NAMESPACE, 'val') : undefined
}

function isWord(element: XmlElement, localName: string) {
  return (
    element.namespaceUri === WORD_NAMESPACE && element.localName === localName
  )
}
