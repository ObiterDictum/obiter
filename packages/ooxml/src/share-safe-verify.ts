import type { OoxmlDocument, SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  MARKING_PROPERTY_TYPES,
} from './parts/custom-properties'
import { parseXmlElements } from './parts/overlay'
import { resolveRelationshipTarget } from './parts/rels'
import { attributeValue, isWord, type XmlElement } from './parts/xml-elements'
import { parseDocx } from './parse'
import { planShareSafeCopy } from './share-safe-inventory'
import {
  shareSafePartFamily,
  type ShareSafePartDisposition,
} from './share-safe-parts'
import {
  shareSafeAttributeVerdict,
  shareSafeElementVerdict,
} from './share-safe-policy'
import { refuseShareSafe } from './share-safe-refusal'

const COMMENT_RESIDUE_PART =
  /(^|\/)(comments|commentsExtended|commentsIds|commentsExtensible|commentsAuthors|people)[^/]*\.xml$/iu

/**
 * The verification half of the policy: re-parse the finished archive and
 * prove the package the recipient opens satisfies the same inventory the
 * copy was built from — no removed class survived, no external pointer
 * remains, and every part still classifies under the allow-list.
 */
export async function verifyShareSafePackage(bytes: Uint8Array) {
  let reparsed: OoxmlDocument
  try {
    reparsed = await parseDocx(bytes)
  } catch {
    refuseShareSafe(
      'unverifiable-output',
      'sanitised package failed to re-parse',
    )
  }
  if (reparsed.model.changes.length > 0 || reparsed.model.comments.length > 0) {
    refuseShareSafe(
      'unverifiable-output',
      'tracked changes or comments survived sanitisation',
    )
  }

  // The same inventory classifies the output: it must be completely clean —
  // nothing left to drop, detach or rewrite.
  const plan = planShareSafeCopy(reparsed)
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') {
      refuseShareSafe(
        'unverifiable-output',
        `part ${name} survived sanitisation unreachable`,
      )
    }
    if (disposition.kind === 'custom-properties' && disposition.orphaned) {
      refuseShareSafe(
        'unverifiable-output',
        'custom properties shipped undeclared',
      )
    }
  }
  if (plan.stripRelationships.size > 0 || plan.detachedReferences.size > 0) {
    refuseShareSafe(
      'unverifiable-output',
      'a stripped relationship survived sanitisation',
    )
  }

  for (const [name, part] of reparsed.sourceParts) {
    if (
      COMMENT_RESIDUE_PART.test(name) ||
      /^docProps\/thumbnail\./iu.test(name) ||
      /^_xmlsignatures\//iu.test(name)
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `comment or preview part ${name} survived`,
      )
    }
    if (part.kind !== 'xml' || !part.overlay) continue
    const elements = parseXmlElements(part.overlay.source)
    const disposition = plan.dispositions.get(name)
    const family = shareSafePartFamily(elements[0]?.namespaceUri ?? '')
    verifyXmlResidue(name, elements, family, disposition?.kind ?? 'keep')
    if (part.role === 'story') verifyStoryResidue(name, elements)
  }
  verifyRelationshipsExternal(reparsed)
  verifyCoreProperties(reparsed)
  verifyCustomProperties(reparsed)
}

/**
 * Residue an inventory re-scan cannot see: the transform's own work is the
 * suspect. Any element whose policy verdict is `remove`/`unwrap`/`refuse`,
 * and any attribute whose verdict is `strip` or a refuse class, must not
 * appear in the output — the input scan already proved the same vocabulary
 * refused there, so a survivor means the transform dropped nothing or the
 * writer misapplied an edit.
 */
function verifyXmlResidue(
  partName: string,
  elements: readonly XmlElement[],
  family: ReturnType<typeof shareSafePartFamily>,
  dispositionKind: ShareSafePartDisposition['kind'],
) {
  for (const element of elements) {
    const verdict = shareSafeElementVerdict(element, family, dispositionKind)
    if (verdict !== 'keep') {
      refuseShareSafe(
        'unverifiable-output',
        `${element.localName} survived sanitisation in ${partName}`,
      )
    }
    for (const attribute of element.attributes) {
      const attrVerdict = shareSafeAttributeVerdict(element, attribute)
      if (attrVerdict === 'strip' || attrVerdict.startsWith('refuse')) {
        refuseShareSafe(
          'unverifiable-output',
          `attribute residue survived in ${partName}`,
        )
      }
      if (
        attrVerdict === 'relationship-pointer' &&
        (isWord(element, 'hyperlink') || isWord(element, 'attachedTemplate'))
      ) {
        refuseShareSafe(
          'unverifiable-output',
          `detached pointer survived in ${partName}`,
        )
      }
    }
  }
}

function verifyStoryResidue(partName: string, elements: readonly XmlElement[]) {
  for (const element of elements) {
    if (
      isWord(element, 'commentRangeStart') ||
      isWord(element, 'commentRangeEnd') ||
      isWord(element, 'commentReference')
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `comment marker survived in ${partName}`,
      )
    }
  }
}

function verifyRelationshipsExternal(document: OoxmlDocument) {
  for (const relationship of document.model.relationships) {
    if (relationship.targetMode?.toLowerCase() === 'external') {
      refuseShareSafe(
        'external-reference',
        'an external relationship survived sanitisation',
      )
    }
    const tail = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (tail === 'hyperlink' || tail === 'attachedTemplate') {
      refuseShareSafe(
        'unverifiable-output',
        'a detached relationship survived sanitisation',
      )
    }
  }
}

/**
 * Core and extended properties must arrive empty at the reader: the
 * transform emits a canonical bare root, so a surviving depth-1 child is
 * residue in either part.
 */
function verifyCoreProperties(document: OoxmlDocument) {
  const byTail = (tail: string) =>
    document.model.relationships.filter(
      (relationship) =>
        relationship.type.slice(relationship.type.lastIndexOf('/') + 1) ===
        tail,
    )
  for (const tail of ['core-properties', 'extended-properties'] as const) {
    const relationship = byTail(tail)[0]
    if (!relationship) continue
    const part = targetPart(document, relationship)
    if (!part?.overlay) continue
    for (const element of parseXmlElements(part.overlay.source)) {
      if (element.depth === 1) {
        refuseShareSafe(
          'unverifiable-output',
          `${tail} metadata survived sanitisation`,
        )
      }
    }
  }
}

/** Every property in the shipped part is a canonical product marking. */
function verifyCustomProperties(document: OoxmlDocument) {
  const relationship = document.model.relationships.find(
    (candidate) =>
      candidate.type.slice(candidate.type.lastIndexOf('/') + 1) ===
      'custom-properties',
  )
  if (!relationship) return
  const part = targetPart(document, relationship)
  if (!part?.overlay) {
    refuseShareSafe('malformed-package', 'custom properties part is malformed')
  }
  const elements = parseXmlElements(part.overlay!.source)
  for (const element of elements) {
    if (
      element.namespaceUri === CUSTOM_PROPERTIES_NAMESPACE &&
      element.localName === 'property'
    ) {
      const name = attributeValue(element, '', 'name')
      if (name === undefined || !(name in MARKING_PROPERTY_TYPES)) {
        refuseShareSafe(
          'unverifiable-output',
          'a foreign custom property survived sanitisation',
        )
      }
    }
  }
}

function targetPart(
  document: OoxmlDocument,
  relationship: OoxmlDocument['model']['relationships'][number],
): SourcePart | undefined {
  try {
    const target = resolveRelationshipTarget(relationship)
    return target ? document.sourceParts.get(target) : undefined
  } catch {
    return undefined
  }
}
