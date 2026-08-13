import type {
  DocumentNumberingLevelWire,
  DocumentNumberingWire,
} from '@obiter/contracts'

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
  const abstracts = new Map<string, DocumentNumberingLevelWire[]>()

  for (const abstract of elements.filter((element) =>
    isWord(element, 'abstractNum'),
  )) {
    const abstractNumberingId = attributeValue(
      abstract,
      WORD_NAMESPACE,
      'abstractNumId',
    )
    if (!abstractNumberingId) continue
    abstracts.set(abstractNumberingId, parseLevels(elements, abstract))
  }

  const numbering: DocumentNumberingWire[] = []

  for (const instance of elements.filter((element) => isWord(element, 'num'))) {
    const numberingId = attributeValue(instance, WORD_NAMESPACE, 'numId')
    if (!numberingId) continue
    const abstractNumberingId = childValue(elements, instance, 'abstractNumId')
    const startValue = descendantValue(elements, instance, 'startOverride')
    const startOverride =
      startValue === undefined ? undefined : Number(startValue)
    const levels = applyLevelOverrides(
      elements,
      instance,
      abstractNumberingId ? (abstracts.get(abstractNumberingId) ?? []) : [],
    )
    numbering.push({
      numberingId,
      ...(abstractNumberingId ? { abstractNumberingId } : {}),
      ...(Number.isInteger(startOverride) ? { startOverride } : {}),
      ...(levels.length > 0 ? { levels } : {}),
      sourceFragment: elementFragment(source, instance),
    })
  }

  return numbering
}

function parseLevels(
  elements: XmlElement[],
  abstract: XmlElement,
): DocumentNumberingLevelWire[] {
  const levels: DocumentNumberingLevelWire[] = []
  for (const level of elements.filter(
    (element) => isWord(element, 'lvl') && isDescendantOf(element, abstract),
  )) {
    const ilvl = Number(attributeValue(level, WORD_NAMESPACE, 'ilvl'))
    if (!Number.isInteger(ilvl) || ilvl < 0 || ilvl > 8) continue
    const startValue = descendantValue(elements, level, 'start')
    const start = startValue === undefined ? undefined : Number(startValue)
    const numFmt = descendantValue(elements, level, 'numFmt') ?? 'decimal'
    const lvlText = descendantValue(elements, level, 'lvlText')
    const indent = indentFromLevel(elements, level)
    levels.push({
      ilvl,
      ...(Number.isInteger(start) && start !== undefined && start > 0
        ? { start }
        : {}),
      numFmt,
      ...(lvlText ? { lvlText } : {}),
      ...indent,
    })
  }
  return levels
}

function applyLevelOverrides(
  elements: XmlElement[],
  instance: XmlElement,
  base: DocumentNumberingLevelWire[],
): DocumentNumberingLevelWire[] {
  if (base.length === 0) return []
  const levels = base.map((level) => ({ ...level }))
  for (const override of elements.filter(
    (element) =>
      isWord(element, 'lvlOverride') && isDescendantOf(element, instance),
  )) {
    const ilvl = Number(attributeValue(override, WORD_NAMESPACE, 'ilvl'))
    const startValue = descendantValue(elements, override, 'startOverride')
    const start = startValue === undefined ? undefined : Number(startValue)
    if (
      !Number.isInteger(ilvl) ||
      !Number.isInteger(start) ||
      start === undefined
    )
      continue
    const target = levels.find((level) => level.ilvl === ilvl)
    if (target) target.start = start
  }
  return levels
}

function indentFromLevel(elements: XmlElement[], level: XmlElement) {
  const indent = elements.find(
    (element) => isWord(element, 'ind') && isDescendantOf(element, level),
  )
  if (!indent) return {}
  const left = Number(attributeValue(indent, WORD_NAMESPACE, 'left'))
  const hanging = Number(attributeValue(indent, WORD_NAMESPACE, 'hanging'))
  return {
    ...(Number.isInteger(left) ? { indentLeftTwips: left } : {}),
    ...(Number.isInteger(hanging) ? { hangingTwips: hanging } : {}),
  }
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
