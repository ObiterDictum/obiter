import {
  activePropertiesContent,
  expandSelfClosingProperties,
  propertyChildInsertPosition,
} from './model-properties'

/**
 * Removes one child element from a `w:pPr`/`w:rPr` fragment while preserving a
 * trailing `w:pPrChange`/`w:rPrChange` history record. The history records the
 * pre-change state, so an untracked edit must never delete inside it.
 */
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

/** Inserts one child into a `w:pPr`/`w:rPr` fragment at its schema position. */
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

/**
 * Applies `patch` to a wire's property fragment — its `w:rPr` or `w:pPr` —
 * appending `patch(empty)` when the wire carries none. Shared by the
 * paragraph-numbering and model-property writers, which otherwise copy it.
 */
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
