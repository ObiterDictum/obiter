import type { DocumentRelationshipWire } from '@obiter/contracts'

import type { OoxmlDocument, SourcePart } from './model'
import {
  createXmlOverlay,
  parseXmlElements,
  serialiseOverlay,
} from './parts/overlay'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import {
  isAllowedElementNamespace,
  MARKUP_COMPAT_NAMESPACE,
  relationshipsPartFor,
  shareSafePartFamily,
  type ShareSafeContentPlan,
  type ShareSafePartDisposition,
  type ShareSafePlan,
} from './share-safe-parts'
import {
  shareSafeAttributeVerdict,
  shareSafeElementVerdict,
} from './share-safe-policy'
import {
  hiddenElementRefuses,
  isSdtScoped,
  SHARE_SAFE_OPAQUE_ELEMENTS,
  SHARE_SAFE_REVISION_ELEMENTS,
  SHARE_SAFE_SDT_POINTER_ELEMENTS,
  SHARE_SAFE_WEB_POINTER_ELEMENTS,
} from './share-safe-word-classes'
import {
  analyseContentTypesPart,
  analyseRelationshipsPart,
} from './share-safe-declarations'
import {
  analyseWordFields,
  collapseCommentRuns,
  rewriteBookmarks,
} from './share-safe-word-content'
import {
  EMBEDDED_ELEMENTS,
  embeddedElementRefusesHidden,
} from './share-safe-drawing-vocabulary'
import { refuseShareSafe } from './share-safe-refusal'

const decoder = new TextDecoder('utf-8', { fatal: true })
const MC_ALTERNATE = /^(AlternateContent|Choice|Fallback)$/u
const WORD_EXTENSION_PREFIX = 'http://schemas.microsoft.com/office/word/'

/**
 * The single content pass over one kept XML part. Everything the emitter
 * needs is decided here — which elements never emit, which wrappers lose
 * their tags, which texts and attributes are rewritten — so the
 * serialiser and the verifier replay identical rules: the verifier runs
 * this same function on the emitted bytes and expects an empty plan.
 *
 * The pass runs on the parsed element tree, so comments, processing
 * instructions, `mc:Ignorable` declarations and unused `xmlns` bindings
 * are absent by construction — nothing lexical reaches the plan.
 */
export function analyseShareSafePart(
  document: OoxmlDocument,
  part: SourcePart,
  disposition: ShareSafePartDisposition,
  plan: ShareSafePlan,
  dropped: ReadonlySet<string>,
  bookmarkRenames: ReadonlyMap<string, string>,
): ShareSafeContentPlan {
  const overlay = part.overlay
  if (overlay && overlay.replacements.size > 0) {
    // Pending edits (the custom-properties adoption writes into the
    // package-level parts) fold into the source the plan is computed on,
    // so element coordinates and the emitted text describe one document.
    try {
      part.overlay = createXmlOverlay(serialiseOverlay(overlay))
    } catch {
      refuseShareSafe(
        'malformed-package',
        `${part.name} carries edits that cannot be rendered`,
      )
    }
  }
  let source: string
  try {
    source = part.overlay?.source ?? decoder.decode(part.originalPayload)
  } catch {
    refuseShareSafe('malformed-package', `${part.name} is not decodable UTF-8`)
  }
  let elements: XmlElement[]
  try {
    elements = parseXmlElements(source)
  } catch {
    refuseShareSafe('malformed-package', `${part.name} is not parseable XML`)
  }
  if (!part.overlay) {
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

  const contentPlan: ShareSafeContentPlan = {
    elements,
    removed: new Set(),
    unwrapped: new Set(),
    textOverrides: new Map(),
    attrOverrides: new Map(),
  }
  const gone = (element: XmlElement) => {
    let cursor: XmlElement | undefined = element
    while (cursor) {
      if (contentPlan.removed.has(cursor)) return true
      cursor = cursor.parent
    }
    return false
  }

  const family = shareSafePartFamily(expected.namespaceUri)
  // Core, app and custom properties emit canonical bytes — the input below
  // the root is discarded wholesale, so nothing inside needs decisions.
  if (family === 'metadata') return contentPlan

  // Markup-compatibility branches resolve only where the family allows the
  // namespace — elsewhere any `mc:` element already fails the namespace
  // check below. Elements inside a dropped branch must not face verdicts.
  if (family === 'word' || family === 'theme') {
    resolveAlternateContent(part, elements, family, gone, contentPlan)
  }

  for (const element of elements) {
    if (gone(element)) continue
    const verdict = shareSafeElementVerdict(element, family, disposition.kind)
    if (verdict === 'refuse') {
      const reason = refuseReasonFor(element)
      refuseShareSafe(
        reason,
        reason === 'hidden-content'
          ? `${part.name} carries hidden content at ${element.qualifiedName}`
          : `${part.name} carries ${element.qualifiedName}, which the share-safe copy cannot prove safe`,
      )
    }
    if (verdict === 'remove') contentPlan.removed.add(element)
    else if (verdict === 'unwrap') contentPlan.unwrapped.add(element)
  }

  if (family === 'relationships') {
    analyseRelationshipsPart(part, elements, plan, dropped, contentPlan)
  }
  if (family === 'content-types') {
    analyseContentTypesPart(part, elements, plan, contentPlan)
  }
  if (family === 'word') {
    collapseCommentRuns(source, elements, contentPlan)
    analyseWordFields(
      part,
      source,
      elements,
      gone,
      bookmarkRenames,
      contentPlan,
    )
  }
  finishAttributes(document, part, elements, gone, plan, contentPlan)
  if (family === 'word') {
    rewriteBookmarks(part, elements, gone, bookmarkRenames, contentPlan)
  }
  return contentPlan
}

/** The refusal a rejected element earns, by the class that rejected it. */
function refuseReasonFor(element: XmlElement) {
  if (
    element.namespaceUri === WORD_NAMESPACE ||
    element.namespaceUri.startsWith(WORD_EXTENSION_PREFIX)
  ) {
    if (SHARE_SAFE_REVISION_ELEMENTS.has(element.localName)) {
      return 'tracked-changes' as const
    }
    if (SHARE_SAFE_OPAQUE_ELEMENTS.has(element.localName)) {
      return 'opaque-payload' as const
    }
    if (SHARE_SAFE_WEB_POINTER_ELEMENTS.has(element.localName)) {
      return 'external-reference' as const
    }
    if (element.namespaceUri === WORD_NAMESPACE) {
      if (hiddenElementRefuses(element)) return 'hidden-content' as const
      if (
        SHARE_SAFE_SDT_POINTER_ELEMENTS.has(element.localName) &&
        !isSdtScoped(element)
      ) {
        return 'external-reference' as const
      }
    }
  }
  if (embeddedElementRefusesHidden(element)) {
    return 'hidden-content' as const
  }
  return 'unsupported-structure' as const
}

/**
 * `mc:AlternateContent` resolves to exactly one branch in the output: the
 * first `Choice` whose `Requires` namespaces this build can emit, else the
 * `Fallback`, else the export refuses rather than guessing. Only the chosen
 * branch's elements ever reach the emitter — the wrapper tags and every
 * other branch are dropped here.
 */
function resolveAlternateContent(
  part: SourcePart,
  elements: readonly XmlElement[],
  family: ReturnType<typeof shareSafePartFamily>,
  gone: (element: XmlElement) => boolean,
  contentPlan: ShareSafeContentPlan,
) {
  for (const element of elements) {
    if (element.namespaceUri !== MARKUP_COMPAT_NAMESPACE || gone(element)) {
      continue
    }
    if (!MC_ALTERNATE.test(element.localName)) {
      refuseShareSafe(
        'unsupported-structure',
        `${part.name} carries unrecognised markup-compatibility element ${element.localName}`,
      )
    }
    if (element.localName !== 'AlternateContent') {
      if (element.parent?.namespaceUri !== MARKUP_COMPAT_NAMESPACE) {
        refuseShareSafe(
          'unsupported-structure',
          `${part.name} carries an orphaned ${element.localName} branch`,
        )
      }
      continue
    }
    const branches = elements.filter(
      (candidate) => candidate.parent === element && !gone(candidate),
    )
    if (
      branches.length === 0 ||
      branches.some(
        (branch) =>
          branch.namespaceUri !== MARKUP_COMPAT_NAMESPACE ||
          (branch.localName !== 'Choice' && branch.localName !== 'Fallback'),
      )
    ) {
      refuseShareSafe(
        'unsupported-structure',
        `${part.name} carries a malformed AlternateContent block`,
      )
    }
    const chosen = branches.find(
      (branch) =>
        branch.localName === 'Choice' && requiresProvable(branch, family),
    )
    const fallback = chosen
      ? undefined
      : branches.find((branch) => branch.localName === 'Fallback')
    if (!chosen && !fallback) {
      refuseShareSafe(
        'unsupported-structure',
        `${part.name} carries an AlternateContent block with no readable branch`,
      )
    }
    contentPlan.unwrapped.add(element)
    for (const branch of branches) {
      if (branch === chosen || branch === fallback) {
        contentPlan.unwrapped.add(branch)
      } else {
        contentPlan.removed.add(branch)
      }
    }
  }
}

/** Every `Requires` token must resolve to a namespace this part emits. */
function requiresProvable(
  choice: XmlElement,
  family: ReturnType<typeof shareSafePartFamily>,
) {
  const requires = attributeValue(choice, '', 'Requires')
  if (requires === undefined) return true
  return requires
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== '')
    .every((token) => {
      const uri = choice.namespaces?.get(token)
      return (
        uri !== undefined &&
        (uri === WORD_NAMESPACE || EMBEDDED_ELEMENTS.has(uri)) &&
        isAllowedElementNamespace(uri, family)
      )
    })
}

/**
 * The attribute pass over everything still standing: verdict refuse
 * classes throw, relationship pointers resolve against the declarations
 * that survive, and detached references (external hyperlinks, attached
 * templates, printer settings) mark their element for unwrap or removal.
 */
function finishAttributes(
  document: OoxmlDocument,
  part: SourcePart,
  elements: readonly XmlElement[],
  gone: (element: XmlElement) => boolean,
  plan: ShareSafePlan,
  contentPlan: ShareSafeContentPlan,
) {
  const declared = new Map<string, DocumentRelationshipWire>()
  for (const relationship of document.model.relationships) {
    if (relationship.sourcePartName === part.name) {
      declared.set(relationship.id, relationship)
    }
  }
  const detached = plan.detachedReferences.get(part.name)
  const relsPart = relationshipsPartFor(part.name)
  const strippedIds = plan.stripRelationships.get(relsPart) ?? new Set<string>()
  const emittedIds = plan.relationshipIds.get(relsPart)

  for (const element of elements) {
    if (gone(element)) continue
    for (const attribute of element.attributes) {
      const verdict = shareSafeAttributeVerdict(element, attribute)
      if (verdict === 'refuse') {
        refuseShareSafe(
          'unsupported-structure',
          `${part.name} carries attribute ${attribute.qualifiedName} in a shape it cannot carry`,
        )
      }
      if (verdict === 'refuse-hidden') {
        refuseShareSafe(
          'hidden-content',
          `hidden drawing object in ${part.name}`,
        )
      }
      if (verdict === 'refuse-revision') {
        refuseShareSafe(
          'tracked-changes',
          `revision identity attribute ${attribute.qualifiedName} in ${part.name}`,
        )
      }
      if (verdict !== 'relationship-pointer') continue
      const relationship = declared.get(attribute.value)
      if (!relationship) {
        refuseShareSafe(
          'external-reference',
          `${part.name} references undeclared relationship ${attribute.value}`,
        )
      }
      if (!strippedIds.has(attribute.value)) {
        // A kept reference ships the canonical `rId` the declaration was
        // rewritten to — the original id is identifier text and drops.
        const canonical = emittedIds?.get(attribute.value)
        if (canonical === undefined) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} references ${attribute.value}, which has no canonical declaration`,
          )
        }
        if (canonical !== attribute.value) {
          contentPlan.attrOverrides.set(attribute, canonical)
        }
        continue
      }
      const shape = detached?.get(attribute.value)
      // Only a `w:hyperlink` detaches cleanly — its children re-emit as
      // plain text. A drawing surface's `a:hlinkClick`/`a:hlinkHover`
      // cannot be unlinked without restructuring the drawing, so it
      // refuses with the rest.
      const detachesLink = shape === 'hyperlink' && isWord(element, 'hyperlink')
      const detachesElement =
        (shape === 'attachedTemplate' && isWord(element, 'attachedTemplate')) ||
        (shape === 'printerSettings' && isWord(element, 'printerSettings'))
      if (!detachesLink && !detachesElement) {
        refuseShareSafe(
          'external-reference',
          `${part.name} points at a relationship that does not ship`,
        )
      }
      if (detachesLink) contentPlan.unwrapped.add(element)
      else contentPlan.removed.add(element)
    }
  }
}
