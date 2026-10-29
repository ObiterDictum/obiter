import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import {
  attributeValue,
  childrenByParent,
  type XmlElement,
} from './parts/xml-elements'
import { canonicalRelationshipTarget } from './share-safe-canonical'
import {
  CONTENT_TYPES_NAMESPACE,
  CONTENT_TYPES_PART,
  PACKAGE_OWNER,
  PACKAGE_REL_NAMESPACE,
  type ShareSafeContentPlan,
  type ShareSafePlan,
} from './share-safe-parts'
import type { SourcePart } from './model'
import { refuseShareSafe } from './share-safe-refusal'

const RELATIONSHIP_ID = /^[A-Za-z_][\w.-]{0,127}$/u
const RELATIONSHIP_URI = /^\S{1,2048}$/u
const CONTENT_TYPE_EXTENSION = /^[A-Za-z0-9]{1,32}$/u
const CONTENT_TYPE_MEDIA =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}(?:\s*;\s*[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}="[^"]{0,255}")*$/u
const CONTENT_TYPE_PART_NAME = /^\/[^\s/]{1,256}(?:\/[^\s/]{1,256}){0,31}$/u
const RELATIONSHIP_TARGET_MODES = new Set(['Internal', 'External'])

function assertWhitespaceOnly(fragment: string, partName: string) {
  const residue = fragment
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<\?[\s\S]*?\?>/gu, '')
  if (!/^\s*$/u.test(residue)) {
    refuseShareSafe(
      'malformed-package',
      `${partName} carries text inside a declaration element`,
    )
  }
}

function assertWhitespaceDeclarationText(
  part: SourcePart,
  elements: readonly XmlElement[],
  namespaceUri: string,
) {
  const source = part.overlay?.source
  if (source === undefined) return
  const children = childrenByParent(elements)
  for (const element of elements) {
    if (
      element.namespaceUri !== namespaceUri ||
      element.endTagStart <= element.startTagEnd
    ) {
      continue
    }
    const childElements = children.get(element) ?? []
    let cursor = element.startTagEnd
    for (const child of childElements) {
      assertWhitespaceOnly(source.slice(cursor, child.start), part.name)
      cursor = child.end
    }
    assertWhitespaceOnly(source.slice(cursor, element.endTagStart), part.name)
  }
}
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
  const seenIds = new Set<string>()
  assertWhitespaceDeclarationText(part, elements, PACKAGE_REL_NAMESPACE)
  for (const element of elements) {
    if (element.namespaceUri !== PACKAGE_REL_NAMESPACE) continue
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
    if (!RELATIONSHIP_ID.test(id)) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} declares an id that is not an xsd:ID`,
      )
    }
    if (!RELATIONSHIP_URI.test(type) || !RELATIONSHIP_URI.test(target)) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} declares an unbounded relationship value`,
      )
    }
    if (seenIds.has(id)) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} declares relationship ${id} twice`,
      )
    }
    seenIds.add(id)
    if (stripIds.has(id)) {
      contentPlan.removed.add(element)
      continue
    }
    if (targetMode !== undefined) {
      if (!RELATIONSHIP_TARGET_MODES.has(targetMode)) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares an unsupported TargetMode`,
        )
      }
      if (targetMode === 'External') {
        refuseShareSafe(
          'external-reference',
          `${part.name} declares an external relationship`,
        )
      }
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
    if (resolved !== undefined) {
      if (resolved.endsWith('.rels') || resolved === CONTENT_TYPES_PART) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} relationship ${id} targets a declaration part`,
        )
      }
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

    const emittedIds =
      plan.relationshipIds.get(part.name) ?? new Map<string, string>()
    plan.relationshipIds.set(part.name, emittedIds)
    const canonicalId = `rId${emittedIds.size + 1}`
    emittedIds.set(id, canonicalId)
    const idNode = element.attributes.find(
      (attribute) =>
        attribute.namespaceUri === '' && attribute.localName === 'Id',
    )
    if (id !== canonicalId && idNode !== undefined) {
      contentPlan.attrOverrides.set(idNode, canonicalId)
    }
    const renamedOwner =
      owner === PACKAGE_OWNER ? owner : plan.partRenames.get(owner)
    const renamedTarget = plan.partRenames.get(resolved)
    if (renamedOwner === undefined || renamedTarget === undefined) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} relationship ${id} has no canonical spelling`,
      )
    }
    const canonicalTarget = canonicalRelationshipTarget(
      renamedOwner,
      renamedTarget,
    )
    if (target !== canonicalTarget) {
      const targetNode = element.attributes.find(
        (attribute) =>
          attribute.namespaceUri === '' && attribute.localName === 'Target',
      )
      if (targetNode !== undefined) {
        contentPlan.attrOverrides.set(targetNode, canonicalTarget)
      }
    }
    const targetModeNode = element.attributes.find(
      (attribute) =>
        attribute.namespaceUri === '' && attribute.localName === 'TargetMode',
    )
    if (targetModeNode !== undefined) {
      contentPlan.attrOverrides.set(targetModeNode, undefined)
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
  const seenDefaults = new Map<string, string>()
  const seenOverrides = new Map<string, string>()
  const shippedDefaults = new Set<string>()
  const shippedOverrides = new Set<string>()
  assertWhitespaceDeclarationText(part, elements, CONTENT_TYPES_NAMESPACE)
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
      if (
        !CONTENT_TYPE_EXTENSION.test(extension) ||
        !CONTENT_TYPE_MEDIA.test(contentType)
      ) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares an out-of-grammar Default entry`,
        )
      }
      const seenDefault = seenDefaults.get(extension.toLowerCase())
      if (seenDefault !== undefined) {
        if (seenDefault === contentType) {
          contentPlan.removed.add(element)
          continue
        }
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares extension ${extension} twice`,
        )
      }
      seenDefaults.set(extension.toLowerCase(), contentType)
      if (!usedExtensions.has(extension.toLowerCase())) {
        contentPlan.removed.add(element)
        continue
      }
      shippedDefaults.add(extension.toLowerCase())
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
      if (
        !CONTENT_TYPE_PART_NAME.test(partName) ||
        !CONTENT_TYPE_MEDIA.test(contentType)
      ) {
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares an out-of-grammar Override entry`,
        )
      }
      const target = partName.replace(/^\//u, '')
      const seenOverride = seenOverrides.get(target)
      if (seenOverride !== undefined) {
        if (seenOverride === contentType) {
          contentPlan.removed.add(element)
          continue
        }
        refuseShareSafe(
          'malformed-package',
          `${part.name} declares part ${target} twice`,
        )
      }
      seenOverrides.set(target, contentType)
      if (!kept.has(target)) {
        contentPlan.removed.add(element)
        continue
      }
      shippedOverrides.add(target)
    }
  }
  for (const name of kept) {
    if (name === CONTENT_TYPES_PART) continue
    const dot = name.lastIndexOf('.')
    if (
      !shippedOverrides.has(name) &&
      (dot === -1 || !shippedDefaults.has(name.slice(dot + 1).toLowerCase()))
    ) {
      refuseShareSafe(
        'malformed-package',
        `kept part ${name} ships with no content-type declaration`,
      )
    }
  }
}
