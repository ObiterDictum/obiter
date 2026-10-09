import type { DocumentRelationshipWire } from '@obiter/contracts'

import {
  fieldInstructionName,
  fieldInstructionsFromElements,
} from './field-instructions'
import type { OoxmlDocument, SourcePart } from './model'
import { createXmlOverlay, parseXmlElements } from './parts/overlay'
import {
  isWord,
  WORD_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'
import {
  isAllowedElementNamespace,
  isContentTypeElement,
  isRelationshipPartElement,
  relationshipsPartFor,
  shareSafePartFamily,
  type ShareSafePartDisposition,
  type ShareSafePartFamily,
  type ShareSafePlan,
} from './share-safe-parts'
import {
  hiddenElementRefuses,
  isFormulaFieldInstruction,
  isPolicyRemovedSubtree,
  SHARE_SAFE_FIELD_NAMES,
  SHARE_SAFE_OPAQUE_ELEMENTS,
  SHARE_SAFE_OPAQUE_FIELDS,
  SHARE_SAFE_REVISION_ELEMENTS,
  SHARE_SAFE_WEB_POINTER_ELEMENTS,
  shareSafeAttributeVerdict,
  shareSafeElementVerdict,
} from './share-safe-policy'
import { refuseShareSafe } from './share-safe-refusal'

const decoder = new TextDecoder('utf-8', { fatal: true })
const EMPTY_DETACHED: ReadonlyMap<string, 'hyperlink' | 'attachedTemplate'> =
  new Map()

/**
 * The element-level half of the inventory, run on every kept XML part —
 * stories, settings, `.rels` declaration parts and the content-type map
 * alike. Each part's root must match the role its relationship declared,
 * every element must sit in a namespace the part's family allows, element
 * names that carry revision markup, hidden content, opaque payloads or
 * external pointers refuse, and every relationship-namespace attribute must
 * resolve to a declaration that itself survives. Field instructions are
 * extracted semantically (CDATA, comments and split runs included) and
 * checked against the bounded field allow-list.
 *
 * Nothing about the check relies on the elements' prefixes — expanded names
 * are resolved before any verdict runs, so a strict-OOXML hybrid or an
 * alias-bound `w:` prefix cannot smuggle content past it.
 */
export function scanXmlSurface(
  document: OoxmlDocument,
  part: SourcePart,
  disposition: ShareSafePartDisposition,
  plan: ShareSafePlan,
) {
  const overlay = part.overlay
  if (overlay && overlay.replacements.size > 0) {
    refuseShareSafe(
      'malformed-package',
      `${part.name} carries unrendered edits`,
    )
  }
  let source: string
  try {
    source = overlay?.source ?? decoder.decode(part.originalPayload)
  } catch {
    refuseShareSafe('malformed-package', `${part.name} is not decodable UTF-8`)
  }
  let elements: XmlElement[]
  try {
    elements = parseXmlElements(source)
  } catch {
    refuseShareSafe('malformed-package', `${part.name} is not parseable XML`)
  }
  if (!overlay) {
    part.overlay = createXmlOverlay(source)
  }

  const root = elements.find((element) => element.depth === 0)
  const expected = disposition.root
  if (
    !expected ||
    !root ||
    root.namespaceUri !== expected.namespaceUri ||
    root.localName !== expected.localName
  ) {
    refuseShareSafe(
      'unsupported-structure',
      `${part.name} root ${root?.qualifiedName ?? '(none)'} is not its declared role's root`,
    )
  }

  const family = shareSafePartFamily(expected.namespaceUri)
  // Core, app and custom properties emit canonical bytes — the input below
  // the root is discarded wholesale, so nothing inside needs checking.
  if (family === 'metadata') return

  const declared = new Map<string, DocumentRelationshipWire>()
  for (const relationship of document.model.relationships) {
    if (relationship.sourcePartName === part.name) {
      declared.set(relationship.id, relationship)
    }
  }
  const detached = plan.detachedReferences.get(part.name) ?? EMPTY_DETACHED
  const strippedIds =
    plan.stripRelationships.get(relationshipsPartFor(part.name)) ??
    new Set<string>()

  for (const element of elements) {
    if (isPolicyRemovedSubtree(element, family, disposition.kind)) continue
    checkElement(element, part, family)
    // Verdict refuses beyond the named classes — a binding pointer in a
    // context the policy does not recognise (`w:dataBinding` outside any
    // control) cannot be proven inert.
    if (
      shareSafeElementVerdict(element, family, disposition.kind) === 'refuse'
    ) {
      refuseShareSafe(
        'unsupported-structure',
        `${part.name} carries ${element.localName} outside its recognised scope`,
      )
    }
    for (const attribute of element.attributes) {
      checkAttribute(element, attribute, part, declared, detached, strippedIds)
    }
  }

  let instructions: string[]
  try {
    instructions = fieldInstructionsFromElements(source, elements)
  } catch {
    refuseShareSafe(
      'malformed-package',
      `field instructions in ${part.name} could not be read`,
    )
  }
  for (const instruction of instructions) {
    if (isFormulaFieldInstruction(instruction)) continue
    const name = fieldInstructionName(instruction)
    if (SHARE_SAFE_FIELD_NAMES.has(name)) continue
    refuseShareSafe(
      SHARE_SAFE_OPAQUE_FIELDS.has(name)
        ? 'opaque-payload'
        : 'external-reference',
      `field instruction ${name === '' ? '(unnamed)' : name} in ${part.name} is outside the share-safe allow-list`,
    )
  }
}

function checkElement(
  element: XmlElement,
  part: SourcePart,
  family: ShareSafePartFamily,
) {
  if (!isAllowedElementNamespace(element.namespaceUri, family)) {
    refuseShareSafe(
      'unsupported-structure',
      `${part.name} carries ${element.qualifiedName} outside its part's allowed namespaces`,
    )
  }
  if (
    family === 'relationships' &&
    !isRelationshipPartElement(element.localName)
  ) {
    refuseShareSafe(
      'unsupported-structure',
      `${part.name} carries ${element.localName} inside a relationships part`,
    )
  }
  if (family === 'content-types' && !isContentTypeElement(element.localName)) {
    refuseShareSafe(
      'unsupported-structure',
      `${part.name} carries ${element.localName} inside the content-types map`,
    )
  }
  if (element.namespaceUri !== WORD_NAMESPACE) return
  if (SHARE_SAFE_REVISION_ELEMENTS.has(element.localName)) {
    refuseShareSafe(
      'tracked-changes',
      `revision markup (${element.localName}) in ${part.name}`,
    )
  }
  if (SHARE_SAFE_OPAQUE_ELEMENTS.has(element.localName)) {
    refuseShareSafe(
      'opaque-payload',
      `opaque inclusion (${element.localName}) in ${part.name}`,
    )
  }
  if (SHARE_SAFE_WEB_POINTER_ELEMENTS.has(element.localName)) {
    refuseShareSafe(
      'external-reference',
      `external pointer (${element.localName}) in ${part.name}`,
    )
  }
  if (hiddenElementRefuses(element)) {
    refuseShareSafe('hidden-content', `hidden content in ${part.name}`)
  }
}

function checkAttribute(
  element: XmlElement,
  attribute: XmlAttribute,
  part: SourcePart,
  declared: ReadonlyMap<string, DocumentRelationshipWire>,
  detached: ReadonlyMap<string, 'hyperlink' | 'attachedTemplate'>,
  strippedIds: ReadonlySet<string>,
) {
  const verdict = shareSafeAttributeVerdict(element, attribute)
  if (verdict === 'refuse-hidden') {
    refuseShareSafe('hidden-content', `hidden drawing object in ${part.name}`)
  }
  if (verdict === 'refuse-revision') {
    refuseShareSafe(
      'tracked-changes',
      `revision identity attribute ${attribute.qualifiedName} in ${part.name}`,
    )
  }
  if (verdict !== 'relationship-pointer') return
  const relationship = declared.get(attribute.value)
  if (!relationship) {
    refuseShareSafe(
      'external-reference',
      `${part.name} references undeclared relationship ${attribute.value}`,
    )
  }
  const shape = detached.get(attribute.value)
  if (shape !== undefined) {
    // A detachable pointer ships only through the element the transform
    // knows how to sever — a hyperlink id on a drawing surface or a
    // template id elsewhere is a dangling external reference.
    const handled =
      (shape === 'hyperlink' && isWord(element, 'hyperlink')) ||
      (shape === 'attachedTemplate' && isWord(element, 'attachedTemplate'))
    if (!handled) {
      refuseShareSafe(
        'external-reference',
        `${part.name} uses a detached relationship through ${element.localName}`,
      )
    }
    return
  }
  if (strippedIds.has(attribute.value)) {
    refuseShareSafe(
      'external-reference',
      `${part.name} points at a relationship that does not ship`,
    )
  }
}
