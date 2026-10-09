import type { OoxmlDocument, SourcePart } from './model'
import {
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
} from './parts/overlay'
import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { RELATIONSHIPS_NAMESPACE } from './structure-xml'
import {
  attributeValue,
  isDescendantOf,
  isWord,
  nearestWordAncestor,
  type XmlElement,
} from './parts/xml-elements'
import {
  applyShareSafeContentEdits,
  emitCanonicalPart,
  rewriteCustomProperties,
  SHARE_SAFE_CANONICAL_EMITS,
  shareSafeOverlayEditScope,
  type ShareSafePartEdits,
} from './share-safe-metadata'
import {
  CONTENT_TYPES_NAMESPACE,
  CONTENT_TYPES_PART,
  PACKAGE_REL_NAMESPACE,
  PACKAGE_RELATIONSHIPS_PART,
  shareSafePartFamily,
  type ShareSafePlan,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * Applies the inventory's verdict to the working copy. Every edit lands as
 * an overlay replacement, so the serialiser either produces the sanitised
 * package or fails the write — there is no partial state.
 */
export function applyShareSafePlan(
  document: OoxmlDocument,
  plan: ShareSafePlan,
) {
  const drop = new Set<string>()
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') drop.add(name)
  }

  for (const [name, part] of document.sourceParts) {
    const disposition = plan.dispositions.get(name)
    if (!disposition || disposition.kind === 'drop' || part.kind !== 'xml') {
      continue
    }
    const overlay = part.overlay
    if (!overlay) {
      refuseShareSafe('malformed-package', `${name} has no parse surface`)
    }

    // Canonical metadata parts discard their input wholesale — the scan
    // already proved the root, so nothing inside needs per-element edits.
    if (
      disposition.kind === 'scrub-core-properties' ||
      disposition.kind === 'scrub-app-properties'
    ) {
      emitCanonicalPart(part, SHARE_SAFE_CANONICAL_EMITS[disposition.kind])
      continue
    }

    const elements = parseXmlElements(overlay.source)

    if (disposition.kind === 'custom-properties') {
      rewriteCustomProperties(
        document,
        part,
        elements,
        disposition.orphaned === true,
      )
      continue
    }

    const edits = shareSafeOverlayEditScope(part)
    const family = shareSafePartFamily(disposition.root?.namespaceUri ?? '')

    if (family === 'word') {
      stripCommentMarkers(elements, edits)
      stripDetachedReferences(plan, part, elements, edits)
    }
    applyShareSafeContentEdits(part, disposition, family, elements, edits)

    if (name.endsWith('.rels')) {
      stripRelationshipElements(plan, part, elements, drop, edits)
    }
  }

  // A relationships part left with no declarations ships nothing; the
  // package-level `_rels/.rels` always keeps the officeDocument pointer.
  for (const [name, part] of document.sourceParts) {
    const disposition = plan.dispositions.get(name)
    if (
      !disposition ||
      disposition.kind === 'drop' ||
      name === PACKAGE_RELATIONSHIPS_PART ||
      !name.endsWith('.rels') ||
      part.kind !== 'xml' ||
      !part.overlay
    ) {
      continue
    }
    const remaining = parseXmlElements(serialiseOverlay(part.overlay)).filter(
      (element) =>
        element.namespaceUri === PACKAGE_REL_NAMESPACE &&
        element.localName === 'Relationship',
    )
    if (remaining.length === 0) drop.add(name)
  }

  stripContentTypeOverrides(document, drop)
  for (const name of drop) document.sourceParts.delete(name)
}

/**
 * Removes comment range markers and reference runs — the shapes a comment
 * surface leaves behind in a story once the comments part itself is gone.
 */
function stripCommentMarkers(
  elements: readonly XmlElement[],
  edits: ShareSafePartEdits,
) {
  for (const element of elements) {
    if (edits.isRemoved(element)) continue
    if (
      isWord(element, 'commentRangeStart') ||
      isWord(element, 'commentRangeEnd') ||
      isWord(element, 'annotationRef')
    ) {
      edits.remove(element)
      continue
    }
    if (!isWord(element, 'commentReference')) continue
    const run = nearestWordAncestor(element, 'r')
    if (!run)
      refuseShareSafe('malformed-package', 'unanchored comment reference')
    // A dedicated CommentReference run is removed whole; a run that also
    // carries content — text, breaks, footnote/endnote references — keeps
    // that content and loses only the marker.
    const runProperties = elements.find(
      (candidate) => candidate.parent === run && isWord(candidate, 'rPr'),
    )
    const carriesContent = elements.some(
      (candidate) =>
        candidate !== element &&
        candidate !== runProperties &&
        isDescendantOf(candidate, run) &&
        !(runProperties && isDescendantOf(candidate, runProperties)),
    )
    if (carriesContent) edits.remove(element)
    else edits.remove(run)
  }
}

/**
 * Removes the elements that consume detached relationships: an external
 * hyperlink unwraps to its visible text, an attached template's element is
 * removed outright.
 */
function stripDetachedReferences(
  plan: ShareSafePlan,
  part: SourcePart,
  elements: readonly XmlElement[],
  edits: ShareSafePartEdits,
) {
  const detached = plan.detachedReferences.get(part.name)
  if (!detached || detached.size === 0) return
  for (const element of elements) {
    if (edits.isRemoved(element)) continue
    if (isWord(element, 'hyperlink')) {
      const id = attributeValue(element, RELATIONSHIPS_NAMESPACE, 'id')
      if (id === undefined || detached.get(id) !== 'hyperlink') continue
      edits.unwrap(element)
      continue
    }
    // Attached templates are removed whole wherever they appear (they are
    // only legal inside settings).
    if (isWord(element, 'attachedTemplate')) {
      const id = attributeValue(element, RELATIONSHIPS_NAMESPACE, 'id')
      if (id !== undefined && detached.get(id) === 'attachedTemplate') {
        edits.remove(element)
      }
    }
  }
}

/**
 * Removes relationship declarations whose target was dropped or whose
 * pointer the policy detached, in every kept `.rels` part.
 */
function stripRelationshipElements(
  plan: ShareSafePlan,
  part: SourcePart,
  elements: readonly XmlElement[],
  droppedParts: Set<string>,
  edits: ShareSafePartEdits,
) {
  const stripIds = plan.stripRelationships.get(part.name) ?? new Set<string>()
  let owner: string
  try {
    owner = relationshipSourcePartName(part.name)
  } catch {
    return
  }
  for (const element of elements) {
    if (edits.isRemoved(element)) continue
    if (
      element.namespaceUri !== PACKAGE_REL_NAMESPACE ||
      element.localName !== 'Relationship'
    ) {
      continue
    }
    const id = attributeValue(element, '', 'Id')
    if (id !== undefined && stripIds.has(id)) {
      edits.remove(element)
      continue
    }
    const target = attributeValue(element, '', 'Target')
    const type = attributeValue(element, '', 'Type')
    if (target === undefined || type === undefined) {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries an undeclarable relationship`,
      )
    }
    let resolved: string | undefined
    try {
      resolved = resolveRelationshipTarget({
        sourcePartName: owner,
        id: id ?? '',
        type,
        target,
        ...(attributeValue(element, '', 'TargetMode') !== undefined
          ? { targetMode: attributeValue(element, '', 'TargetMode') }
          : {}),
        sourceFragment: '',
      })
    } catch {
      resolved = undefined
    }
    if (resolved !== undefined && droppedParts.has(resolved)) {
      edits.remove(element)
    }
  }
}

/** Removes content-type overrides naming parts that no longer ship. */
function stripContentTypeOverrides(
  document: OoxmlDocument,
  droppedParts: Set<string>,
) {
  const part = document.sourceParts.get(CONTENT_TYPES_PART)
  if (!part || part.kind !== 'xml' || !part.overlay) return
  const overlay = part.overlay
  for (const element of parseXmlElements(overlay.source)) {
    if (
      element.namespaceUri !== CONTENT_TYPES_NAMESPACE ||
      element.localName !== 'Override'
    ) {
      continue
    }
    const partName = attributeValue(element, '', 'PartName')
    if (partName === undefined) continue
    if (droppedParts.has(partName.replace(/^\//u, ''))) {
      setOverlayReplacement(overlay, `share-safe:ct:${element.start}`, {
        start: element.start,
        end: element.end,
        value: '',
      })
      part.dirty = true
    }
  }
}
