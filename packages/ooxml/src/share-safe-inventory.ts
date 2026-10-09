import type { DocumentRelationshipWire } from '@obiter/contracts'

import {
  fieldInstructionName,
  fieldInstructionsFromElements,
} from './field-instructions'
import type { OoxmlDocument, SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_PART,
} from './parts/custom-properties'
import { createXmlOverlay, parseXmlElements } from './parts/overlay'
import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { RELATIONSHIPS_NAMESPACE } from './structure-xml'
import {
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { refuseShareSafe } from './share-safe-refusal'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const PACKAGE_RELATIONSHIPS_PART = '_rels/.rels'
const PACKAGE_OWNER = ''

const OFFICE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const PACKAGE_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships/'

const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * What the copy may do with a part once its relationship type has proven
 * the role. The classification is the allow-list: anything a relationship
 * does not promote to a known role, or that no relationship reaches at all,
 * does not ship — the serialiser copies only parts this inventory names.
 */
export type ShareSafePartDisposition =
  | { kind: 'keep' }
  | { kind: 'drop' }
  | { kind: 'scrub-core-properties' }
  | { kind: 'scrub-app-properties' }
  | { kind: 'scrub-settings' }
  | { kind: 'custom-properties'; orphaned: boolean }

/**
 * The inventory's verdict for one package: a disposition for every part and
 * the relationship declarations the transform strips because their target
 * was dropped or the pointer is detachable (an external hyperlink is
 * unlinked, an attached template detached — neither ships its target).
 */
export type ShareSafePlan = {
  dispositions: Map<string, ShareSafePartDisposition>
  /** relationships part name → relationship ids to remove from it */
  stripRelationships: Map<string, Set<string>>
  /** owning part name → detached relationship ids and their shapes */
  detachedReferences: Map<string, Map<string, 'hyperlink' | 'attachedTemplate'>>
}

/**
 * Tracked-change and revision markup, the complete element set: wrappers the
 * parser models (`ins`, `del`, `moveFrom`, `moveTo`, `pPrChange`,
 * `rPrChange`) plus the shapes it does not — property, table, section and
 * customXml revisions, range markers, and the deleted-text carriers that
 * keep redacted text recoverable. Any of them in any part refuses the copy.
 */
export const SHARE_SAFE_REVISION_ELEMENTS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlIns',
  'customXmlDel',
  'customXmlMoveFrom',
  'customXmlMoveTo',
  'delText',
  'delInstrText',
])

/** Payloads this layer cannot inspect — opaque embedded content. */
export const SHARE_SAFE_OPAQUE_ELEMENTS = new Set([
  'altChunk',
  'object',
  'OLEObject',
  'control',
  'subDoc',
])

/**
 * Field instructions that fetch content from outside the package —
 * including `HYPERLINK`, whose instruction embeds the destination URL the
 * relationship-detach path strips from `w:hyperlink` elements.
 */
export const SHARE_SAFE_FETCHING_FIELDS = new Set([
  'INCLUDETEXT',
  'INCLUDEPICTURE',
  'LINK',
  'DDE',
  'DDEAUTO',
  'IMPORT',
  'RD',
  'HYPERLINK',
])

/**
 * Relationships whose targets the copy removes outright — comment surfaces
 * (every recognised namespace vintage), the `people` part, thumbnail
 * previews and digital signatures, which are void once sanitised.
 */
const DROP_RELATIONSHIP_TAILS = new Set([
  'comments',
  'commentsExtended',
  'commentsIds',
  'commentsExtensible',
  'commentsAuthors',
  'people',
  'thumbnail',
  'signature',
  'origin',
  'certificate',
])

/** Relationship types the copy keeps, and the role their target takes. */
const KEEP_RELATIONSHIPS = new Map<
  string,
  { disposition: ShareSafePartDisposition; binary: boolean; unique: boolean }
>([
  [
    `${OFFICE_REL}officeDocument`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}styles`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}numbering`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}fontTable`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}webSettings`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}theme`,
    { disposition: { kind: 'keep' }, binary: false, unique: true },
  ],
  [
    `${OFFICE_REL}header`,
    { disposition: { kind: 'keep' }, binary: false, unique: false },
  ],
  [
    `${OFFICE_REL}footer`,
    { disposition: { kind: 'keep' }, binary: false, unique: false },
  ],
  [
    `${OFFICE_REL}footnotes`,
    { disposition: { kind: 'keep' }, binary: false, unique: false },
  ],
  [
    `${OFFICE_REL}endnotes`,
    { disposition: { kind: 'keep' }, binary: false, unique: false },
  ],
  [
    `${OFFICE_REL}image`,
    { disposition: { kind: 'keep' }, binary: true, unique: false },
  ],
  [
    `${OFFICE_REL}font`,
    { disposition: { kind: 'keep' }, binary: true, unique: false },
  ],
  [
    `${OFFICE_REL}settings`,
    { disposition: { kind: 'scrub-settings' }, binary: false, unique: true },
  ],
  [
    `${PACKAGE_REL}metadata/core-properties`,
    {
      disposition: { kind: 'scrub-core-properties' },
      binary: false,
      unique: true,
    },
  ],
  [
    `${OFFICE_REL}extended-properties`,
    {
      disposition: { kind: 'scrub-app-properties' },
      binary: false,
      unique: true,
    },
  ],
  [
    `${OFFICE_REL}custom-properties`,
    {
      disposition: { kind: 'custom-properties', orphaned: false },
      binary: false,
      unique: true,
    },
  ],
])

/** A target naming a resource outside the package: URI scheme or UNC path. */
const EXTERNAL_TARGET = /^[a-z][a-z0-9+.-]*:|^\\\\/iu

const EMPTY_DETACHED = new Map<string, 'hyperlink' | 'attachedTemplate'>()

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
 * its content kind matches, and its XML surface passes the scans. Otherwise
 * it is dropped (recognised residue classes and unreachable payloads) or
 * the export is refused (declared content outside the allow-list, ambiguity
 * a reader could resolve the unsafe way, or material this layer cannot
 * verify). The document itself is never mutated; the caller clones first.
 */
export function planShareSafeCopy(document: OoxmlDocument): ShareSafePlan {
  if (document.trackedChanges.size > 0 || document.model.changes.length > 0) {
    refuseShareSafe('tracked changes remain in the document')
  }

  // Part names are case-insensitive to an OPC consumer; two entries spelling
  // the same name differently make scrubbing hit one file while a recipient
  // may read the other.
  const folded = new Map<string, string>()
  for (const name of document.sourceParts.keys()) {
    const existing = folded.get(name.toLowerCase())
    if (existing !== undefined && existing !== name) {
      refuseShareSafe(
        `package parts ${existing} and ${name} differ only by case`,
      )
    }
    folded.set(name.toLowerCase(), name)
  }

  const plan: ShareSafePlan = {
    dispositions: new Map(),
    stripRelationships: new Map(),
    detachedReferences: new Map(),
  }
  const dropped = new Set<string>()
  const uniqueSeen = new Set<string>()

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
            `part ${target} is declared under two different roles`,
          )
        }
        if (target) dropped.add(target)
        continue
      }

      const external = isExternal(relationship)
      if (tail === 'hyperlink' || tail === 'attachedTemplate') {
        // Both are detachable: an external hyperlink unwraps to its text and
        // an attached template is dropped with its pointer. A hyperlink
        // relationship without an external target is not a shape Word
        // writes — ambiguous, so it refuses.
        if (tail === 'hyperlink' && !external) {
          refuseShareSafe(
            'hyperlink relationship without an external target is ambiguous',
          )
        }
        strip()
        const detached =
          plan.detachedReferences.get(relationship.sourcePartName) ??
          new Map<string, 'hyperlink' | 'attachedTemplate'>()
        detached.set(relationship.id, tail)
        plan.detachedReferences.set(relationship.sourcePartName, detached)
        const target = tryResolveTarget(relationship)
        if (target) dropped.add(target)
        continue
      }
      if (external) {
        refuseShareSafe(`relationship ${tail} reaches outside the package`)
      }

      const spec = KEEP_RELATIONSHIPS.get(relationship.type)
      if (!spec) {
        refuseShareSafe(
          `relationship ${tail} is outside the share-safe allow-list`,
        )
      }
      if (spec.unique && !uniqueSeen.add(relationship.type)) {
        refuseShareSafe(`relationship ${tail} is declared more than once`)
      }
      const target = tryResolveTarget(relationship)
      if (!target || !document.sourceParts.has(target)) {
        refuseShareSafe(`declared ${tail} part is missing or unresolvable`)
      }
      if (dropped.has(target)) {
        refuseShareSafe(`part ${target} is declared under two different roles`)
      }
      const part = document.sourceParts.get(target)!
      if ((part.kind === 'binary') !== spec.binary) {
        refuseShareSafe(
          `${tail} target ${target} has an unexpected content kind`,
        )
      }
      const existing = plan.dispositions.get(target)
      if (existing !== undefined) {
        if (existing.kind !== spec.disposition.kind) {
          refuseShareSafe(
            `part ${target} is declared under two different roles`,
          )
        }
      } else {
        plan.dispositions.set(target, spec.disposition)
        reachable.add(target)
        queue.push(target)
      }
    }
  }

  if (
    [...document.model.relationships].filter(
      (relationship) =>
        relationship.sourcePartName === PACKAGE_OWNER &&
        relationship.type === `${OFFICE_REL}officeDocument`,
    ).length !== 1
  ) {
    refuseShareSafe('the package declares no single main document part')
  }

  for (const [name, part] of document.sourceParts) {
    if (plan.dispositions.has(name)) continue
    if (name === CONTENT_TYPES_PART) {
      plan.dispositions.set(name, { kind: 'keep' })
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
      plan.dispositions.set(name, {
        kind: ownerShips ? 'keep' : 'drop',
      })
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
          ? { kind: 'custom-properties', orphaned: true }
          : { kind: 'drop' },
      )
      continue
    }
    // Nothing declared this part. Rather than guess at its payload, it does
    // not ship.
    plan.dispositions.set(name, { kind: 'drop' })
  }

  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') continue
    const part = document.sourceParts.get(name)
    if (!part || part.kind !== 'xml') continue
    scanXmlSurface(
      document,
      part,
      plan.detachedReferences.get(part.name) ?? EMPTY_DETACHED,
      disposition.kind === 'custom-properties',
    )
  }
  return plan
}

function relationshipsPartFor(sourcePartName: string) {
  if (sourcePartName === PACKAGE_OWNER) return PACKAGE_RELATIONSHIPS_PART
  const slash = sourcePartName.lastIndexOf('/')
  const directory = slash === -1 ? '' : sourcePartName.slice(0, slash + 1)
  const name = slash === -1 ? sourcePartName : sourcePartName.slice(slash + 1)
  return `${directory}_rels/${name}.rels`
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

/**
 * The element-level half of the inventory, run on every kept XML part —
 * `word/document.xml` stories and `.rels` declaration parts alike. Refuses
 * revision markup, hidden content, opaque inclusions, relationship pointers
 * with no declaration (or one the transform detached under a different
 * shape), and field instructions that fetch outside the package.
 */
export function scanXmlSurface(
  document: OoxmlDocument,
  part: SourcePart,
  detached: ReadonlyMap<string, 'hyperlink' | 'attachedTemplate'>,
  lenientCustomProperties = false,
) {
  const overlay = part.overlay
  if (overlay && overlay.replacements.size > 0) {
    refuseShareSafe(`${part.name} carries unrendered edits`)
  }
  let source: string
  try {
    source = overlay?.source ?? decoder.decode(part.originalPayload)
  } catch {
    refuseShareSafe(`${part.name} is not decodable UTF-8`)
  }
  let elements: XmlElement[]
  try {
    elements = parseXmlElements(source)
  } catch {
    refuseShareSafe(`${part.name} is not parseable XML`)
  }
  if (!overlay) {
    part.overlay = createXmlOverlay(source)
  }

  const story = part.role === 'story'
  const declared = new Map<string, DocumentRelationshipWire>()
  for (const relationship of document.model.relationships) {
    if (relationship.sourcePartName === part.name) {
      declared.set(relationship.id, relationship)
    }
  }

  for (const element of elements) {
    if (element.namespaceUri === WORD_NAMESPACE) {
      if (SHARE_SAFE_REVISION_ELEMENTS.has(element.localName)) {
        refuseShareSafe(
          `revision markup (${element.localName}) in ${part.name}`,
        )
      }
      if (SHARE_SAFE_OPAQUE_ELEMENTS.has(element.localName)) {
        refuseShareSafe(
          `opaque inclusion (${element.localName}) in ${part.name}`,
        )
      }
      if (
        (element.localName === 'vanish' || element.localName === 'webHidden') &&
        (story ? !!nearestWordAncestor(element, 'r') : true)
      ) {
        // In a story, hidden styling off a run (e.g. paragraph-mark
        // properties) hides formatting marks, not content, and stays.
        refuseShareSafe(`hidden content in ${part.name}`)
      }
    }
    if (lenientCustomProperties) continue
    for (const attribute of element.attributes) {
      if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE) continue
      const relationship = declared.get(attribute.value)
      if (!relationship) {
        refuseShareSafe(
          `${part.name} references undeclared relationship ${attribute.value}`,
        )
      }
      const shape = detached.get(attribute.value)
      if (shape !== undefined) {
        const handled =
          (shape === 'hyperlink' && isWord(element, 'hyperlink')) ||
          (shape === 'attachedTemplate' && isWord(element, 'attachedTemplate'))
        if (!handled) {
          refuseShareSafe(
            `${part.name} uses a detached relationship through ${element.localName}`,
          )
        }
      }
    }
  }

  for (const instruction of fieldInstructionsFromElements(source, elements)) {
    const name = fieldInstructionName(instruction)
    if (SHARE_SAFE_FETCHING_FIELDS.has(name)) {
      refuseShareSafe(
        `field instruction ${name} in ${part.name} fetches external content`,
      )
    }
  }
}
