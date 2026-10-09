import type { OoxmlDocument, SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  MARKING_PROPERTY_TYPES,
} from './parts/custom-properties'
import { parseXmlElements } from './parts/overlay'
import { resolveRelationshipTarget } from './parts/rels'
import { RELATIONSHIPS_NAMESPACE, W14_NAMESPACE } from './structure-xml'
import { attributeValue, isWord, WORD_NAMESPACE } from './parts/xml-elements'
import { parseDocx } from './parse'
import { planShareSafeCopy } from './share-safe-inventory'
import { refuseShareSafe } from './share-safe-refusal'
import { SETTINGS_REMOVE_ELEMENTS } from './share-safe-transform'

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
    refuseShareSafe('sanitised package failed to re-parse')
  }
  if (reparsed.model.changes.length > 0 || reparsed.model.comments.length > 0) {
    refuseShareSafe('tracked changes or comments survived sanitisation')
  }

  // The same inventory classifies the output: it must be completely clean —
  // nothing left to drop, detach or rewrite.
  const plan = planShareSafeCopy(reparsed)
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop') {
      refuseShareSafe(`part ${name} survived sanitisation unreachable`)
    }
    if (disposition.kind === 'custom-properties' && disposition.orphaned) {
      refuseShareSafe('custom properties shipped undeclared')
    }
  }
  if (plan.stripRelationships.size > 0 || plan.detachedReferences.size > 0) {
    refuseShareSafe('a stripped relationship survived sanitisation')
  }

  for (const [name, part] of reparsed.sourceParts) {
    if (
      COMMENT_RESIDUE_PART.test(name) ||
      /^docProps\/thumbnail\./iu.test(name) ||
      /^_xmlsignatures\//iu.test(name)
    ) {
      refuseShareSafe(`comment or preview part ${name} survived`)
    }
    if (part.kind !== 'xml' || !part.overlay) continue
    const elements = parseXmlElements(part.overlay.source)
    verifyXmlResidue(name, elements)
    if (part.role === 'story') verifyStoryResidue(name, elements)
  }
  verifyRelationshipsExternal(reparsed)
  verifyCoreProperties(reparsed)
  verifySettings(reparsed)
  verifyCustomProperties(reparsed)
}

/**
 * Residue an inventory re-scan cannot see: comment markers are stripped
 * rather than refused on input, provenance attributes are stripped rather
 * than refused, and a surviving `w:hyperlink`/`w:attachedTemplate` must no
 * longer carry a relationship pointer.
 */
function verifyXmlResidue(
  partName: string,
  elements: ReturnType<typeof parseXmlElements>,
) {
  for (const element of elements) {
    for (const attribute of element.attributes) {
      if (
        (attribute.namespaceUri === WORD_NAMESPACE &&
          attribute.localName.toLowerCase().startsWith('rsid')) ||
        (attribute.namespaceUri === W14_NAMESPACE &&
          (attribute.localName === 'paraId' ||
            attribute.localName === 'textId'))
      ) {
        refuseShareSafe(`provenance attribute survived in ${partName}`)
      }
      if (
        attribute.namespaceUri === RELATIONSHIPS_NAMESPACE &&
        (isWord(element, 'hyperlink') || isWord(element, 'attachedTemplate'))
      ) {
        refuseShareSafe(`detached pointer survived in ${partName}`)
      }
    }
  }
}

function verifyStoryResidue(
  partName: string,
  elements: ReturnType<typeof parseXmlElements>,
) {
  for (const element of elements) {
    if (
      isWord(element, 'commentRangeStart') ||
      isWord(element, 'commentRangeEnd') ||
      isWord(element, 'commentReference')
    ) {
      refuseShareSafe(`comment marker survived in ${partName}`)
    }
  }
}

function verifyRelationshipsExternal(document: OoxmlDocument) {
  for (const relationship of document.model.relationships) {
    if (relationship.targetMode?.toLowerCase() === 'external') {
      refuseShareSafe('an external relationship survived sanitisation')
    }
    const tail = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (tail === 'hyperlink' || tail === 'attachedTemplate') {
      refuseShareSafe('a detached relationship survived sanitisation')
    }
  }
}

/**
 * Core and extended properties must arrive empty at the reader: the
 * transform removes every element below the root, so a surviving depth-1
 * child is residue in either part.
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
        refuseShareSafe(`${tail} metadata survived sanitisation`)
      }
    }
  }
}

/** Settings must carry none of the tracking/provenance elements the
 * transform removes — verified on the part the relationship names, wherever
 * it sits. */
function verifySettings(document: OoxmlDocument) {
  const relationship = document.model.relationships.find(
    (candidate) =>
      candidate.type.slice(candidate.type.lastIndexOf('/') + 1) === 'settings',
  )
  if (!relationship) return
  const part = targetPart(document, relationship)
  if (!part?.overlay) return
  for (const element of parseXmlElements(part.overlay.source)) {
    if (
      element.namespaceUri === WORD_NAMESPACE &&
      SETTINGS_REMOVE_ELEMENTS.has(element.localName)
    ) {
      refuseShareSafe(`settings provenance survived sanitisation`)
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
    refuseShareSafe('custom properties part is malformed')
  }
  const elements = parseXmlElements(part.overlay!.source)
  for (const element of elements) {
    if (
      element.namespaceUri === CUSTOM_PROPERTIES_NAMESPACE &&
      element.localName === 'property'
    ) {
      const name = attributeValue(element, '', 'name')
      if (name === undefined || !(name in MARKING_PROPERTY_TYPES)) {
        refuseShareSafe('a foreign custom property survived sanitisation')
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
