import { documentEditHyperlinkTargetSchema } from '@obiter/contracts'
import { RELATIONSHIPS_NAMESPACE } from '../structure-xml'
import {
  attributeValue,
  nearestWordAncestor,
  type XmlElement,
} from './xml-elements'

/**
 * A run nested in a stored `w:hyperlink` carries the relationship's target,
 * resolved on the part that owns the story — an `r:id` means nothing outside
 * its own `.rels` part. Internal links (`w:anchor`, no `r:id`) carry none.
 * A stored target gets the write path's scheme allowlist and length bound at
 * this point: one a hostile package plants (`javascript:`, an unbounded
 * string) is never set on the wire, so no consumer can render it as an
 * address while the part bytes stay untouched.
 */
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
