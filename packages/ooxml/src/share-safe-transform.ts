import type { OoxmlDocument } from './model'
import { parseXmlElements, setOverlayReplacement } from './parts/overlay'
import { emitShareSafePart } from './share-safe-emit'
import {
  emitCanonicalPart,
  rewriteCustomProperties,
  SHARE_SAFE_CANONICAL_EMITS,
} from './share-safe-metadata'
import {
  PACKAGE_REL_NAMESPACE,
  PACKAGE_RELATIONSHIPS_PART,
  type ShareSafePlan,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * Applies the inventory's verdict to the working copy. Kept XML parts are
 * emitted canonically from their content plans — the serialised bytes are
 * the plan's output, not the input with edits — so lexical content the
 * parser never modelled cannot survive. A failed write fails the whole
 * export rather than leaving partial state.
 */
export function applyShareSafePlan(
  document: OoxmlDocument,
  plan: ShareSafePlan,
) {
  for (const [name, part] of document.sourceParts) {
    const disposition = plan.dispositions.get(name)
    if (!disposition || disposition.kind === 'drop') continue

    if (part.kind === 'binary') {
      // Binary parts serialise straight from `originalPayload` — a dirty
      // flag would demand an overlay they do not have.
      const payload = plan.binaryPayloads.get(name)
      if (payload !== undefined) part.originalPayload = payload
      continue
    }

    const overlay = part.overlay
    if (!overlay) {
      refuseShareSafe('malformed-package', `${name} has no parse surface`)
    }

    // Canonical metadata parts discard their input wholesale — the
    // analysis already proved the root.
    if (
      disposition.kind === 'scrub-core-properties' ||
      disposition.kind === 'scrub-app-properties'
    ) {
      emitCanonicalPart(part, SHARE_SAFE_CANONICAL_EMITS[disposition.kind])
      continue
    }
    if (disposition.kind === 'custom-properties') {
      rewriteCustomProperties(
        document,
        part,
        parseXmlElements(overlay.source),
        disposition.orphaned === true,
      )
      continue
    }

    const contentPlan = plan.contentPlans.get(name)
    if (!contentPlan) {
      refuseShareSafe(
        'unverifiable-output',
        `${name} has no content plan to emit from`,
      )
    }
    const emitted = emitShareSafePart(part, contentPlan)
    if (emitted !== overlay.source) {
      setOverlayReplacement(overlay, 'share-safe:emit', {
        start: 0,
        end: overlay.source.length,
        value: emitted,
      })
      part.dirty = true
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
      part.kind !== 'xml'
    ) {
      continue
    }
    const contentPlan = plan.contentPlans.get(name)
    if (!contentPlan) continue
    const surviving = contentPlan.elements.filter(
      (element) =>
        element.namespaceUri === PACKAGE_REL_NAMESPACE &&
        element.localName === 'Relationship' &&
        !contentPlan.removed.has(element),
    )
    if (surviving.length === 0) {
      plan.dispositions.set(name, { kind: 'drop' })
    }
  }

  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') document.sourceParts.delete(name)
  }
}
