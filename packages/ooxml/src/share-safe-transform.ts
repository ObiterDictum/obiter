import type { OoxmlDocument } from './model'
import { parseXmlElements, setOverlayReplacement } from './parts/overlay'
import {
  canonicalContentTypesXml,
  canonicalRelsPartName,
} from './share-safe-canonical'
import { emitShareSafePart } from './share-safe-emit'
import {
  emitCanonicalPart,
  rewriteCustomProperties,
  SHARE_SAFE_CANONICAL_EMITS,
} from './share-safe-metadata'
import {
  CONTENT_TYPES_PART,
  PACKAGE_REL_NAMESPACE,
  PACKAGE_RELATIONSHIPS_PART,
  type ShareSafePlan,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

export function applyShareSafePlan(
  document: OoxmlDocument,
  plan: ShareSafePlan,
) {
  for (const [name, part] of document.sourceParts) {
    const disposition = plan.dispositions.get(name)
    if (!disposition || disposition.kind === 'drop') continue

    if (part.kind === 'binary') {
      const payload = plan.binaryPayloads.get(name)
      if (payload !== undefined) part.originalPayload = payload
      continue
    }

    const overlay = part.overlay
    if (!overlay) {
      refuseShareSafe('malformed-package', `${name} has no parse surface`)
    }

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

    if (name === CONTENT_TYPES_PART) {
      const emitted = canonicalContentTypesXml(plan)
      if (emitted !== overlay.source) {
        setOverlayReplacement(overlay, 'share-safe:emit', {
          start: 0,
          end: overlay.source.length,
          value: emitted,
        })
        part.dirty = true
      }
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

  const renames: [string, string][] = []
  for (const name of document.sourceParts.keys()) {
    const canonical = name.endsWith('.rels')
      ? canonicalRelsPartName(name, plan.partRenames)
      : plan.partRenames.get(name)
    if (canonical !== undefined && canonical !== name) {
      renames.push([name, canonical])
    }
  }
  for (const [name, canonical] of renames) {
    const part = document.sourceParts.get(name)
    if (part === undefined) continue
    document.sourceParts.delete(name)
    part.name = canonical
    document.sourceParts.set(canonical, part)
  }
}
