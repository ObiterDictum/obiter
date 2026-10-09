import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { attributeValue, type XmlElement } from './parts/xml-elements'
import {
  CONTENT_TYPES_NAMESPACE,
  PACKAGE_REL_NAMESPACE,
  type ShareSafeContentPlan,
  type ShareSafePlan,
} from './share-safe-parts'
import type { SourcePart } from './model'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * The package-declaration halves of the content analysis: `.rels` parts and
 * `[Content_Types].xml` carry no story content, only declarations, so their
 * checks are shaped around what the plan keeps and drops rather than the
 * element vocabulary. Both refuse a malformed declaration and remove only
 * the entries whose targets no longer ship.
 */
/**
 * `.rels` parts: declarations the plan strips go, declarations whose
 * target no longer ships go, and every survivor is checked against the
 * package — no external pointer, no dangling target, no undeclarable
 * declaration.
 */
export function analyseRelationshipsPart(
  part: SourcePart,
  elements: readonly XmlElement[],
  plan: ShareSafePlan,
  dropped: ReadonlySet<string>,
  contentPlan: ShareSafeContentPlan,
) {
  const stripIds = plan.stripRelationships.get(part.name) ?? new Set<string>()
  let owner: string
  try {
    owner = relationshipSourcePartName(part.name)
  } catch {
    refuseShareSafe(
      'malformed-package',
      `${part.name} is not a valid relationships part`,
    )
  }
  const kept = keptPartNames(plan)
  for (const element of elements) {
    if (element.namespaceUri !== PACKAGE_REL_NAMESPACE) continue
    // Shape is `Relationships` at the root, `Relationship` directly
    // beneath it — a nested declaration is a document no writer makes.
    if (
      (element.localName === 'Relationships' && element.depth !== 0) ||
      (element.localName === 'Relationship' && element.depth !== 1)
    ) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries a misplaced ${element.localName}`,
      )
    }
    if (element.localName !== 'Relationship') continue
    const id = attributeValue(element, '', 'Id')
    const type = attributeValue(element, '', 'Type')
    const target = attributeValue(element, '', 'Target')
    const targetMode = attributeValue(element, '', 'TargetMode')
    if (id === undefined || type === undefined || target === undefined) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries an undeclarable relationship`,
      )
    }
    if (stripIds.has(id)) {
      contentPlan.removed.add(element)
      continue
    }
    if (targetMode !== undefined && targetMode.toLowerCase() === 'external') {
      refuseShareSafe(
        'external-reference',
        `${part.name} declares an external relationship`,
      )
    }
    let resolved: string | undefined
    try {
      resolved = resolveRelationshipTarget({
        sourcePartName: owner,
        id,
        type,
        target,
        ...(targetMode !== undefined ? { targetMode } : {}),
        sourceFragment: '',
      })
    } catch {
      resolved = undefined
    }
    if (resolved === undefined || !kept.has(resolved)) {
      if (resolved !== undefined && dropped.has(resolved)) {
        contentPlan.removed.add(element)
        continue
      }
      refuseShareSafe(
        'malformed-package',
        `${part.name} relationship ${id} points at a part that does not ship`,
      )
    }
  }
}

function keptPartNames(plan: ShareSafePlan) {
  const kept = new Set<string>()
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind !== 'drop') kept.add(name)
  }
  return kept
}

/**
 * `[Content_Types].xml`: overrides naming parts that no longer ship are
 * removed, `Default` declarations whose extension no kept part uses go
 * with them, and duplicate or malformed declarations refuse.
 */
export function analyseContentTypesPart(
  part: SourcePart,
  elements: readonly XmlElement[],
  plan: ShareSafePlan,
  contentPlan: ShareSafeContentPlan,
) {
  const kept = keptPartNames(plan)
  const usedExtensions = new Set<string>()
  for (const name of kept) {
    const dot = name.lastIndexOf('.')
    if (dot !== -1) usedExtensions.add(name.slice(dot + 1).toLowerCase())
  }
  const seenDefaults = new Set<string>()
  const seenOverrides = new Set<string>()
  for (const element of elements) {
    if (element.namespaceUri !== CONTENT_TYPES_NAMESPACE) continue
    if (
      (element.localName === 'Types' && element.depth !== 0) ||
      ((element.localName === 'Default' || element.localName === 'Override') &&
        element.depth !== 1)
    ) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries a misplaced ${element.localName}`,
      )
    }
    if (element.localName === 'Default') {
      const extension = attributeValue(element, '', 'Extension')
      const contentType = attributeValue(element, '', 'ContentType')
      if (extension === undefined || contentType === undefined) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries an undeclarable Default entry`,
        )
      }
      if (!seenDefaults.add(extension.toLowerCase())) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares extension ${extension} twice`,
        )
      }
      if (!usedExtensions.has(extension.toLowerCase())) {
        contentPlan.removed.add(element)
      }
      continue
    }
    if (element.localName === 'Override') {
      const partName = attributeValue(element, '', 'PartName')
      const contentType = attributeValue(element, '', 'ContentType')
      if (partName === undefined || contentType === undefined) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} carries an undeclarable Override entry`,
        )
      }
      const target = partName.replace(/^\//u, '')
      if (!seenOverrides.add(target)) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares part ${target} twice`,
        )
      }
      if (!kept.has(target)) {
        contentPlan.removed.add(element)
      }
    }
  }
}
