import type { DocumentRelationshipWire } from '@obiter/contracts'

import { elementFragment, parseXmlElements } from './overlay'
import { attributeValue, requiredAttribute } from './xml-elements'

const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'

export type RelationshipPart = {
  sourcePartName: string
  relationships: DocumentRelationshipWire[]
}

export function parseRelationshipPart(partName: string, source: string) {
  const sourcePartName = relationshipSourcePartName(partName)
  const relationships = parseXmlElements(source)
    .filter(
      (element) =>
        element.namespaceUri === RELATIONSHIPS_NAMESPACE &&
        element.localName === 'Relationship',
    )
    .map((element) => {
      const id = requiredAttribute(element, 'Id', 'Relationship')
      const type = requiredAttribute(element, 'Type', 'Relationship')
      const target = requiredAttribute(element, 'Target', 'Relationship')
      const targetMode = attributeValue(element, '', 'TargetMode')
      return {
        sourcePartName,
        id,
        type,
        target,
        ...(targetMode ? { targetMode } : {}),
        sourceFragment: elementFragment(source, element),
      }
    })

  return { sourcePartName, relationships } satisfies RelationshipPart
}

export function resolveRelationshipTarget(
  relationship: DocumentRelationshipWire,
) {
  if (relationship.targetMode?.toLowerCase() === 'external') return undefined
  if (relationship.target.startsWith('/')) {
    return normalisePartName(relationship.target.slice(1))
  }
  const slash = relationship.sourcePartName.lastIndexOf('/')
  const directory =
    slash === -1 ? '' : relationship.sourcePartName.slice(0, slash + 1)
  return normalisePartName(`${directory}${relationship.target}`)
}

export function relationshipKind(type: string) {
  const name = type.slice(type.lastIndexOf('/') + 1)
  if (
    name === 'header' ||
    name === 'footer' ||
    name === 'footnotes' ||
    name === 'endnotes' ||
    name === 'comments' ||
    name === 'styles' ||
    name === 'numbering'
  ) {
    return name
  }
  return undefined
}

function relationshipSourcePartName(partName: string) {
  if (partName === '_rels/.rels') return ''
  const marker = '/_rels/'
  const index = partName.lastIndexOf(marker)
  if (index === -1 || !partName.endsWith('.rels')) {
    throw new Error('Invalid relationship part name')
  }
  const directory = partName.slice(0, index + 1)
  const sourceName = partName.slice(index + marker.length, -'.rels'.length)
  return `${directory}${sourceName}`
}

function normalisePartName(value: string) {
  const parts: string[] = []
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0)
        throw new Error('Relationship target escapes package')
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}
