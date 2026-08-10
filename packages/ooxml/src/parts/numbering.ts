import type { DocumentNumberingWire } from '@obiter/contracts'

import {
  attributeValue,
  elementFragment,
  parseXmlElements,
  type XmlElement,
} from './overlay'

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

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

function childValue(elements: XmlElement[], parent: XmlElement, name: string) {
  const child = elements.find(
    (element) => element.parent === parent && isWord(element, name),
  )
  return child ? attributeValue(child, WORD_NAMESPACE, 'val') : undefined
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

function isDescendantOf(element: XmlElement, ancestor: XmlElement) {
  let parent = element.parent
  while (parent) {
    if (parent === ancestor) return true
    parent = parent.parent
  }
  return false
}

function isWord(element: XmlElement, localName: string) {
  return (
    element.namespaceUri === WORD_NAMESPACE && element.localName === localName
  )
}
