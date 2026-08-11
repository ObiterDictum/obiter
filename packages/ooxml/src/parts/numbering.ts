import type { DocumentNumberingWire } from '@obiter/contracts'

import { elementFragment, parseXmlElements } from './overlay'
import {
  attributeValue,
  childValue,
  isDescendantOf,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './xml-elements'

export function parseNumbering(source: string) {
  const elements = parseXmlElements(source)
  const numbering: DocumentNumberingWire[] = []

  for (const instance of elements.filter((element) => isWord(element, 'num'))) {
    const numberingId = attributeValue(instance, WORD_NAMESPACE, 'numId')
    if (!numberingId) continue
    const abstractNumberingId = childValue(elements, instance, 'abstractNumId')
    const startValue = descendantValue(elements, instance, 'startOverride')
    const startOverride =
      startValue === undefined ? undefined : Number(startValue)
    numbering.push({
      numberingId,
      ...(abstractNumberingId ? { abstractNumberingId } : {}),
      ...(Number.isInteger(startOverride) ? { startOverride } : {}),
      sourceFragment: elementFragment(source, instance),
    })
  }

  return numbering
}

function descendantValue(
  elements: XmlElement[],
  ancestor: XmlElement,
  name: string,
) {
  const descendant = elements.find(
    (element) => isDescendantOf(element, ancestor) && isWord(element, name),
  )
  return descendant
    ? attributeValue(descendant, WORD_NAMESPACE, 'val')
    : undefined
}
