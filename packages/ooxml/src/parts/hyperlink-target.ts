import { documentEditHyperlinkTargetSchema } from '@obiter/contracts'
import { RELATIONSHIPS_NAMESPACE } from '../structure-xml'
import {
  attributeValue,
  nearestWordAncestor,
  type XmlElement,
} from './xml-elements'

export function runHyperlinkTarget(
  runElement: XmlElement,
  hyperlinkTargets: ReadonlyMap<string, string> | undefined,
) {
  const link = nearestWordAncestor(runElement, 'hyperlink')
  if (!link) return undefined
  const relationshipId = attributeValue(link, RELATIONSHIPS_NAMESPACE, 'id')
  const target = relationshipId
    ? hyperlinkTargets?.get(relationshipId)
    : undefined
  return target !== undefined &&
    documentEditHyperlinkTargetSchema.safeParse(target).success
    ? target
    : undefined
}
