import {
  activePropertiesContent,
  expandSelfClosingProperties,
  propertyChildInsertPosition,
} from './model-properties'

export function stripPropertyChild(fragment: string, localName: string) {
  const changeStart = fragment.search(/<w:(?:pPr|rPr)Change\b/u)
  const active =
    changeStart === -1 ? fragment : activePropertiesContent(fragment)
  const tail = changeStart === -1 ? '' : fragment.slice(changeStart)
  return `${active.replace(
    new RegExp(
      `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
      'u',
    ),
    '',
  )}${tail}`
}

export function insertPropertyChild(
  fragment: string,
  localName: string,
  instruction: string,
) {
  if (/\/\s*>$/u.test(fragment)) {
    const name = /<w:(pPr|rPr)\b/u.exec(fragment)?.[1]
    if (name === 'pPr' || name === 'rPr') {
      return expandSelfClosingProperties(fragment, 'w', name, instruction)
    }
  }
  const position = propertyChildInsertPosition(fragment, localName)
  return `${fragment.slice(0, position)}${instruction}${fragment.slice(position)}`
}

export function patchPropertyFragments(
  wire: { preservedXmlFragments: string[] },
  patch: (xml: string) => string,
  empty: string,
) {
  const index = wire.preservedXmlFragments.findIndex((fragment) =>
    /<w:(?:rPr|pPr)\b/u.test(fragment),
  )
  if (index === -1) {
    wire.preservedXmlFragments.push(patch(empty))
    return
  }
  wire.preservedXmlFragments[index] = patch(
    wire.preservedXmlFragments[index] ?? empty,
  )
}
