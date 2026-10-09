import type { DocumentRelationshipWire } from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_PART,
} from './parts/custom-properties'
import { adoptOrphanedCustomPropertiesPart } from './parts/custom-properties-write'
import { parseXmlElements } from './parts/overlay'
import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { attributeValue, isWord, WORD_NAMESPACE } from './parts/xml-elements'
import { inspectBinaryPayload } from './share-safe-binary'
import { analyseShareSafePart } from './share-safe-content'
import {
  CONTENT_TYPES_NAMESPACE,
  CONTENT_TYPES_PART,
  DROP_RELATIONSHIP_TAILS,
  KEEP_RELATIONSHIPS,
  PACKAGE_OWNER,
  PACKAGE_REL_NAMESPACE,
  relationshipsPartFor,
  type ShareSafePlan,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

const OFFICE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const decoder = new TextDecoder('utf-8', { fatal: true })

/** A target naming a resource outside the package: URI scheme or UNC path. */
const EXTERNAL_TARGET = /^[a-z][a-z0-9+.-]*:|^\\\\/iu

function isExternal(relationship: DocumentRelationshipWire) {
  return (
    relationship.targetMode?.toLowerCase() === 'external' ||
    EXTERNAL_TARGET.test(relationship.target)
  )
}

function tryResolveTarget(relationship: DocumentRelationshipWire) {
  try {
    return resolveRelationshipTarget(relationship)
  } catch {
    return undefined
  }
}

/**
 * Classifies every part in the package and collects the relationship and
 * element edits the transform applies. Nothing is copied on faith: a part
 * ships only when a recognised relationship type reaches it through the
 * package graph — from `_rels/.rels` down through kept parts' own `.rels` —
 * its declared root matches the role, and its XML surface passes the
 * element-level analysis in `share-safe-content`. Otherwise it is dropped
 * (recognised residue classes and unreachable payloads) or the export is
 * refused (declared content outside the allow-list, ambiguity a reader
 * could resolve the unsafe way, or material this layer cannot verify).
 * The document itself is never mutated; the caller clones first.
 */
export function planShareSafeCopy(document: OoxmlDocument): ShareSafePlan {
  if (document.trackedChanges.size > 0 || document.model.changes.length > 0) {
    refuseShareSafe('tracked-changes', 'tracked changes remain in the document')
  }

  // Part names are case-insensitive to an OPC consumer; two entries spelling
  // the same name differently make scrubbing hit one file while a recipient
  // may read the other.
  const folded = new Map<string, string>()
  for (const name of document.sourceParts.keys()) {
    const existing = folded.get(name.toLowerCase())
    if (existing !== undefined && existing !== name) {
      refuseShareSafe(
        'malformed-package',
        `package parts ${existing} and ${name} differ only by case`,
      )
    }
    folded.set(name.toLowerCase(), name)
  }

  const plan: ShareSafePlan = {
    dispositions: new Map(),
    stripRelationships: new Map(),
    detachedReferences: new Map(),
    contentPlans: new Map(),
    binaryPayloads: new Map(),
    bookmarkRenames: new Map(),
  }
  const dropped = new Set<string>()
  const uniqueSeen = new Set<string>()
  // Binary parts carry their relationship's tail through to payload
  // inspection — an `image` and a `font` read their bytes differently.
  const binaryTails = new Map<string, string>()

  const relationshipsByOwner = new Map<string, DocumentRelationshipWire[]>()
  for (const relationship of document.model.relationships) {
    const list = relationshipsByOwner.get(relationship.sourcePartName) ?? []
    list.push(relationship)
    relationshipsByOwner.set(relationship.sourcePartName, list)
  }

  // Reachability walk: a part ships only when the package graph reaches it
  // through kept relationships. Declarations inside dropped or orphaned
  // `.rels` parts are never evaluated — their content cannot ship, so it
  // cannot refuse the export either.
  const reachable = new Set<string>([PACKAGE_OWNER])
  const queue = [PACKAGE_OWNER]
  while (queue.length > 0) {
    const owner = queue.shift()!
    for (const relationship of relationshipsByOwner.get(owner) ?? []) {
      const tail = relationship.type.slice(
        relationship.type.lastIndexOf('/') + 1,
      )
      const relsPart = relationshipsPartFor(relationship.sourcePartName)
      const strip = () => {
        const set = plan.stripRelationships.get(relsPart) ?? new Set<string>()
        set.add(relationship.id)
        plan.stripRelationships.set(relsPart, set)
      }

      if (DROP_RELATIONSHIP_TAILS.has(tail)) {
        strip()
        const target = tryResolveTarget(relationship)
        // A target a kept relationship also reaches would ship under two
        // roles — one of which this copy refuses to carry.
        if (target && plan.dispositions.has(target)) {
          refuseShareSafe(
            'malformed-package',
            `part ${target} is declared under two different roles`,
          )
        }
        if (target) dropped.add(target)
        continue
      }

      const external = isExternal(relationship)
      if (
        tail === 'hyperlink' ||
        tail === 'attachedTemplate' ||
        tail === 'printerSettings'
      ) {
        // All three are detachable: an external hyperlink unwraps to its
        // text, an attached template and a printer-settings record drop
        // with their pointers. A hyperlink relationship without an
        // external target is not a shape Word writes — ambiguous, so it
        // refuses; a printer-settings pointer that escapes the package is
        // an external reference like any other.
        if (tail === 'hyperlink' && !external) {
          refuseShareSafe(
            'malformed-package',
            'hyperlink relationship without an external target is ambiguous',
          )
        }
        if (tail === 'printerSettings' && external) {
          refuseShareSafe(
            'external-reference',
            'printer settings reach outside the package',
          )
        }
        strip()
        const detached =
          plan.detachedReferences.get(relationship.sourcePartName) ??
          new Map<
            string,
            'hyperlink' | 'attachedTemplate' | 'printerSettings'
          >()
        detached.set(relationship.id, tail)
        plan.detachedReferences.set(relationship.sourcePartName, detached)
        const target = tryResolveTarget(relationship)
        if (target) dropped.add(target)
        continue
      }
      if (external) {
        refuseShareSafe(
          'external-reference',
          `relationship ${tail} reaches outside the package`,
        )
      }

      const spec = KEEP_RELATIONSHIPS.get(relationship.type)
      if (!spec) {
        refuseShareSafe(
          'unsupported-structure',
          `relationship ${tail} is outside the share-safe allow-list`,
        )
      }
      if (spec.unique && !uniqueSeen.add(relationship.type)) {
        refuseShareSafe(
          'malformed-package',
          `relationship ${tail} is declared more than once`,
        )
      }
      const target = tryResolveTarget(relationship)
      if (!target || !document.sourceParts.has(target)) {
        refuseShareSafe(
          'malformed-package',
          `declared ${tail} part is missing or unresolvable`,
        )
      }
      if (dropped.has(target)) {
        refuseShareSafe(
          'malformed-package',
          `part ${target} is declared under two different roles`,
        )
      }
      const part = document.sourceParts.get(target)!
      if ((part.kind === 'binary') !== spec.binary) {
        refuseShareSafe(
          'malformed-package',
          `${tail} target ${target} has an unexpected content kind`,
        )
      }
      const existing = plan.dispositions.get(target)
      if (existing !== undefined) {
        if (existing.kind !== spec.kind) {
          refuseShareSafe(
            'malformed-package',
            `part ${target} is declared under two different roles`,
          )
        }
      } else {
        plan.dispositions.set(target, { kind: spec.kind, root: spec.root })
        reachable.add(target)
        queue.push(target)
      }
      if (spec.binary) binaryTails.set(target, tail)
    }
  }

  if (
    [...document.model.relationships].filter(
      (relationship) =>
        relationship.sourcePartName === PACKAGE_OWNER &&
        relationship.type === `${OFFICE_REL}/officeDocument`,
    ).length !== 1
  ) {
    refuseShareSafe(
      'malformed-package',
      'the package declares no single main document part',
    )
  }

  for (const [name, part] of document.sourceParts) {
    if (plan.dispositions.has(name)) continue
    if (name === CONTENT_TYPES_PART) {
      plan.dispositions.set(name, {
        kind: 'keep',
        root: {
          namespaceUri: CONTENT_TYPES_NAMESPACE,
          localName: 'Types',
        },
      })
      continue
    }
    if (name.endsWith('.rels')) {
      let owner: string
      try {
        owner = relationshipSourcePartName(name)
      } catch {
        // Not a relationships part a consumer can address — dead payload.
        plan.dispositions.set(name, { kind: 'drop' })
        continue
      }
      const ownerShips =
        owner === PACKAGE_OWNER || (reachable.has(owner) && !dropped.has(owner))
      plan.dispositions.set(
        name,
        ownerShips
          ? {
              kind: 'keep',
              root: {
                namespaceUri: PACKAGE_REL_NAMESPACE,
                localName: 'Relationships',
              },
            }
          : { kind: 'drop' },
      )
      continue
    }
    if (dropped.has(name)) {
      plan.dispositions.set(name, { kind: 'drop' })
      continue
    }
    if (name === CUSTOM_PROPERTIES_PART) {
      // An orphaned custom.xml is adopted only when it reads as a real
      // Properties part: the markings it may carry are product state worth
      // keeping. An unreadable file at the name is dead payload — dropped
      // like anything else unreferenced.
      plan.dispositions.set(
        name,
        customPropertiesShape(part)
          ? {
              kind: 'custom-properties',
              orphaned: true,
              root: {
                namespaceUri: CUSTOM_PROPERTIES_NAMESPACE,
                localName: 'Properties',
              },
            }
          : { kind: 'drop' },
      )
      continue
    }
    // Nothing declared this part. Rather than guess at its payload, it does
    // not ship.
    plan.dispositions.set(name, { kind: 'drop' })
  }

  // An orphaned custom.xml adopted for its markings must declare itself
  // before the content pass plans `_rels/.rels` and `[Content_Types].xml`
  // — the declarations it writes land as pending overlay edits, and the
  // content pass folds them into the text it plans against.
  for (const [name, disposition] of plan.dispositions) {
    if (
      disposition.kind === 'custom-properties' &&
      disposition.orphaned === true &&
      document.sourceParts.has(name)
    ) {
      try {
        adoptOrphanedCustomPropertiesPart(document)
      } catch (cause) {
        if (cause instanceof OoxmlError) {
          refuseShareSafe(
            'malformed-package',
            'orphaned custom properties could not be declared',
          )
        }
        throw cause
      }
    }
  }

  // Kept binary parts prove their payload before anything is written —
  // an image is re-serialised metadata-free and a font shows its magic.
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') continue
    const part = document.sourceParts.get(name)
    if (!part || part.kind !== 'binary') continue
    const tail = binaryTails.get(name)
    if (tail === undefined) {
      refuseShareSafe(
        'malformed-package',
        `binary part ${name} ships without a classifying relationship`,
      )
    }
    const payload = inspectBinaryPayload(part, tail)
    if (payload !== undefined) plan.binaryPayloads.set(name, payload)
  }

  // Every bookmark name the kept surface carries is replaced by a
  // generated `bm<n>` — collection runs across all word parts first so
  // the rewrites the content pass records use the complete map.
  let bookmarkCounter = 0
  const nextBookmark = () => {
    bookmarkCounter += 1
    return `bm${bookmarkCounter}`
  }
  for (const [name, part] of document.sourceParts) {
    const disposition = plan.dispositions.get(name)
    if (
      !disposition ||
      disposition.kind === 'drop' ||
      part.kind !== 'xml' ||
      disposition.root?.namespaceUri !== WORD_NAMESPACE
    ) {
      continue
    }
    let elements
    try {
      elements = parseXmlElements(
        part.overlay?.source ?? decoder.decode(part.originalPayload),
      )
    } catch {
      // The content pass below owns the malformed-package refusal.
      continue
    }
    for (const element of elements) {
      if (isWord(element, 'bookmarkStart')) {
        const value = attributeValue(element, WORD_NAMESPACE, 'name')
        if (value !== undefined && !plan.bookmarkRenames.has(value)) {
          plan.bookmarkRenames.set(value, nextBookmark())
        }
      }
      if (
        isWord(element, 'name') &&
        element.parent !== undefined &&
        isWord(element.parent, 'ffData')
      ) {
        const value = attributeValue(element, WORD_NAMESPACE, 'val')
        if (value !== undefined && !plan.bookmarkRenames.has(value)) {
          plan.bookmarkRenames.set(value, nextBookmark())
        }
      }
    }
  }

  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') continue
    const part = document.sourceParts.get(name)
    if (!part || part.kind !== 'xml') continue
    plan.contentPlans.set(
      name,
      analyseShareSafePart(
        document,
        part,
        disposition,
        plan,
        dropped,
        plan.bookmarkRenames,
      ),
    )
  }
  return plan
}

function customPropertiesShape(part: SourcePart) {
  if (part.kind !== 'xml') return false
  try {
    const source = part.overlay?.source ?? decoder.decode(part.originalPayload)
    const elements = parseXmlElements(source)
    const root = elements.find((element) => element.depth === 0)
    return (
      !!root &&
      root.namespaceUri === CUSTOM_PROPERTIES_NAMESPACE &&
      root.localName === 'Properties'
    )
  } catch {
    return false
  }
}
