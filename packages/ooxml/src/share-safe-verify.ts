import type { OoxmlDocument, SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  MARKING_PROPERTY_TYPES,
} from './parts/custom-properties'
import { parseXmlElements } from './parts/overlay'
import { resolveRelationshipTarget } from './parts/rels'
import { attributeValue } from './parts/xml-elements'
import { parseDocx } from './parse'
import { verifyBinaryPayload } from './share-safe-binary'
import { checkShareSafeXmlBytes } from './share-safe-bytecheck'
import { planShareSafeCopy } from './share-safe-inventory'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * Parts that may never ride in the emitted package — comment surfaces,
 * people records, thumbnails, signatures, customXml payloads, glossary
 * documents, printer settings and the effects-only style sheet.
 */
const FORBIDDEN_PART =
  /(^|\/)(comments|commentsExtended|commentsIds|commentsExtensible|commentsAuthors|people)[^/]*\.xml$|\/(glossary|customXml|stylesWithEffects)\/|\/printerSettings\.|\/_xmlsignatures?\/|^docProps\/thumbnail\.|_xmlsignatures\//iu

const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * The verification half of the policy: re-parse the finished archive and
 * prove the package the recipient opens satisfies the same inventory the
 * copy was built from. The plan the output replays to must be completely
 * clean — nothing left to drop, detach, remove or rewrite — and every
 * emitted part's bytes are re-walked lexeme by lexeme for the constructs
 * canonical emission promised would be absent.
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
  for (const [name, contentPlan] of plan.contentPlans) {
    if (
      contentPlan.removed.size > 0 ||
      contentPlan.unwrapped.size > 0 ||
      contentPlan.textOverrides.size > 0 ||
      contentPlan.attrOverrides.size > 0
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `${name} still carries content the policy would change`,
      )
    }
  }

  // Binary parts re-inspect: the payload must strip to itself.
  const binaryTails = new Map<string, string>()
  for (const relationship of reparsed.model.relationships) {
    const tail = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (tail !== 'image' && tail !== 'font') continue
    try {
      const target = resolveRelationshipTarget(relationship)
      if (target !== undefined) binaryTails.set(target, tail)
    } catch {
      refuseShareSafe('unverifiable-output', 'a binary target is unresolvable')
    }
  }
  const bookmarkNames = new Set<string>()
  const anchorTargets: string[] = []
  for (const [name, part] of reparsed.sourceParts) {
    if (FORBIDDEN_PART.test(name)) {
      refuseShareSafe(
        'unverifiable-output',
        `forbidden part ${name} survived sanitisation`,
      )
    }
    if (part.kind === 'binary') {
      const tail = binaryTails.get(name)
      if (tail === undefined) {
        refuseShareSafe(
          'unverifiable-output',
          `binary part ${name} ships undeclared`,
        )
      }
      verifyBinaryPayload(part, tail)
      continue
    }
    let source: string
    try {
      source = part.overlay?.source ?? decoder.decode(part.originalPayload)
    } catch {
      refuseShareSafe('unverifiable-output', `${name} cannot be re-read`)
    }
    const result = checkShareSafeXmlBytes(part, source)
    for (const bookmark of result.bookmarkNames) bookmarkNames.add(bookmark)
    anchorTargets.push(...result.anchorTargets)
  }
  // An `w:anchor` pointing at a bookmark that did not ship is a dead
  // pointer; a name the byte check did not generate was never rewritten.
  for (const anchor of anchorTargets) {
    if (!bookmarkNames.has(anchor)) {
      refuseShareSafe(
        'unverifiable-output',
        `anchor ${anchor} names a bookmark that did not ship`,
      )
    }
  }
  verifyRelationshipsExternal(reparsed)
  verifyCoreProperties(reparsed)
  verifyCustomProperties(reparsed)
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
    if (
      tail === 'hyperlink' ||
      tail === 'attachedTemplate' ||
      tail === 'printerSettings'
    ) {
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
