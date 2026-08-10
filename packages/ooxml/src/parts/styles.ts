import type { DocumentStyleWire } from '@obiter/contracts'

import { elementFragment, parseXmlElements } from './overlay'
import {
  attributeValue,
  childValue,
  isWord,
  WORD_NAMESPACE,
} from './xml-elements'

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
