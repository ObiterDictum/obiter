import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { attributeValue, type XmlElement } from './parts/xml-elements'
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

/**
 * The package-declaration halves of the content analysis: `.rels` parts and
 * `[Content_Types].xml` carry no story content, only declarations, so their
 * checks are shaped around what the plan keeps and drops rather than the
 * element vocabulary. Both refuse a malformed declaration and remove only
 * the entries whose targets no longer ship.
 */

/** `xsd:ID` — an NCName: letter or underscore, then name characters. */
export const RELATIONSHIP_ID = /^[A-Za-z_][\w.-]{0,127}$/u
/** `xsd:anyURI` for a declaration slot — bounded, no whitespace. */
export const RELATIONSHIP_URI = /^\S{1,2048}$/u
/** `ST_Extension` reduced to the extension alphabet Office writes. */
export const CONTENT_TYPE_EXTENSION = /^[A-Za-z0-9]{1,32}$/u
/** `ST_ContentType` — a `token/token` media type with optional params. */
export const CONTENT_TYPE_MEDIA =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}(?:\s*;\s*[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}="[^"]{0,255}")*$/u
/** `xsd:anyURI` part names — `/`-rooted, bounded segments. */
export const CONTENT_TYPE_PART_NAME =
  /^\/[^\s/]{1,256}(?:\/[^\s/]{1,256}){0,31}$/u
/** `ST_TargetMode` — the two spellings the enumeration declares. */
export const RELATIONSHIP_TARGET_MODES = new Set(['Internal', 'External'])

/**
 * No declaration element carries text: `Relationships`, `Relationship`,
 * `Types`, `Default` and `Override` are all empty-content or element-only
 * shapes. Whitespace between declarations is fine; anything else is a
 * payload riding a channel with no legal text.
 */
/**
 * One text gap inside a declaration element: canonical emission already
 * drops comments and processing instructions, so only the residue after
 * those lexical spans matters — it must be whitespace.
 */
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
  for (const element of elements) {
    if (
      element.namespaceUri !== namespaceUri ||
      element.endTagStart <= element.startTagEnd
    ) {
      continue
    }
    const children = elements.filter((child) => child.parent === element)
    let cursor = element.startTagEnd
    for (const child of children) {
      assertWhitespaceOnly(source.slice(cursor, child.start), part.name)
      cursor = child.end
    }
    assertWhitespaceOnly(source.slice(cursor, element.endTagStart), part.name)
  }
}
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
  // Two declarations spelling one `Id` make `r:id` resolution ambiguous —
  // a reader could follow either. Refuse rather than pick.
  const seenIds = new Set<string>()
  assertWhitespaceDeclarationText(part, elements, PACKAGE_REL_NAMESPACE)
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
      // `TargetMode` is a two-spelling enumeration — anything else,
      // including a differently-cased `external`, is malformed input.
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
      // A relationship targeting a declaration part — another `.rels` or
      // the content-types stream — is a shape OPC gives no meaning to.
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

    // Canonical emission: a surviving declaration ships a generated
    // `rId<n>` in document order, the target spelled relative to the
    // canonical owner name, and no `TargetMode` — internal targets are the
    // only kind that survive, so the attribute carries nothing.
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
  // Extensions and part names already declared, mapped to the type they
  // declared. A repeat carrying the same type is redundant and drops;
  // a repeat carrying a different type is ambiguous and refuses.
  const seenDefaults = new Map<string, string>()
  const seenOverrides = new Map<string, string>()
  // The declarations that survive — a kept part must end up covered by
  // one of them, not by an entry the plan already dropped.
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
  // Every kept part must end up typed: an `Override` naming it, or a
  // `Default` covering its extension. A part without coverage is a
  // package a recipient cannot consistently decode — refuse. The
  // content-types part itself is covered by the container contract.
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
