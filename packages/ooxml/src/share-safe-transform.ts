import {
  CUSTOM_PROPERTIES_NAMESPACE,
  adoptOrphanedCustomPropertiesPart,
  markingPropertyXml,
  MARKING_PROPERTY_TYPES,
} from './parts/custom-properties'
import type { OoxmlDocument, SourcePart } from './model'
import { OoxmlError } from './model'
import {
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
} from './parts/overlay'
import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import { RELATIONSHIPS_NAMESPACE, W14_NAMESPACE } from './structure-xml'
import {
  attributeValue,
  isDescendantOf,
  isWord,
  nearestWordAncestor,
  WORD_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'
import type { ShareSafePlan } from './share-safe-inventory'
import { refuseShareSafe } from './share-safe-refusal'
import { decodeXmlReferences } from './xml-lexemes'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const PACKAGE_RELATIONSHIPS_PART = '_rels/.rels'
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'
const PACKAGE_REL_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * Settings elements that carry provenance, tracking state or fetchable
 * pointers: tracking mode must not transfer to the recipient, `docVars` and
 * `rsids` are edit provenance, an attached schema/template is a package or
 * external reference, and mail-merge settings carry a data source.
 */
export const SETTINGS_REMOVE_ELEMENTS = new Set([
  'trackRevisions',
  'docVars',
  'rsids',
  'attachedSchema',
  'attachedTemplate',
  'mailMerge',
  'savePreviewPicture',
])

/**
 * Provenance attributes removed from every kept part: `rsid*` session ids
 * correlate edits with a Word session and `w14` paragraph/text ids correlate
 * two copies of one lineage. Neither is content.
 */
function isProvenanceAttribute(attribute: XmlAttribute) {
  if (
    attribute.namespaceUri === WORD_NAMESPACE &&
    attribute.localName.toLowerCase().startsWith('rsid')
  ) {
    return true
  }
  return (
    attribute.namespaceUri === W14_NAMESPACE &&
    (attribute.localName === 'paraId' || attribute.localName === 'textId')
  )
}

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
    if (!overlay) refuseShareSafe(`${name} has no parse surface`)
    const elements = parseXmlElements(overlay.source)
    const removed: { start: number; end: number }[] = []
    const removeElement = (element: XmlElement) => {
      removed.push({ start: element.start, end: element.end })
      setOverlayReplacement(overlay, `share-safe:${element.start}`, {
        start: element.start,
        end: element.end,
        value: '',
      })
      part.dirty = true
    }

    if (part.role === 'story') {
      stripCommentMarkers(elements, removeElement)
    }

    stripDetachedReferences(plan, part, elements, removeElement, removed)

    if (disposition.kind === 'scrub-settings') {
      for (const element of elements) {
        if (
          element.namespaceUri === WORD_NAMESPACE &&
          SETTINGS_REMOVE_ELEMENTS.has(element.localName)
        ) {
          removeElement(element)
        }
      }
    }

    if (disposition.kind === 'scrub-core-properties') {
      emptyRootChildren(part, elements)
    }
    if (disposition.kind === 'scrub-app-properties') {
      for (const element of elements) {
        if (element.depth === 1) removeElement(element)
      }
    }
    if (disposition.kind === 'custom-properties') {
      rewriteCustomProperties(document, part, elements, disposition.orphaned)
    }

    stripProvenanceAttributes(part, elements, removed)

    if (name.endsWith('.rels')) {
      stripRelationshipElements(
        document,
        plan,
        part,
        elements,
        drop,
        removeElement,
      )
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

/** Removes comment range markers and reference runs from a story part. */
function stripCommentMarkers(
  elements: XmlElement[],
  removeElement: (element: XmlElement) => void,
) {
  for (const element of elements) {
    if (
      isWord(element, 'commentRangeStart') ||
      isWord(element, 'commentRangeEnd')
    ) {
      removeElement(element)
      continue
    }
    if (!isWord(element, 'commentReference')) continue
    const run = nearestWordAncestor(element, 'r')
    if (!run) refuseShareSafe('unanchored comment reference')
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
    removeElement(carriesContent ? element : run)
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
  elements: XmlElement[],
  removeElement: (element: XmlElement) => void,
  removed: { start: number; end: number }[],
) {
  const detached = plan.detachedReferences.get(part.name)
  if (!detached || detached.size === 0) return
  const overlay = part.overlay
  if (!overlay) refuseShareSafe(`${part.name} has no parse surface`)
  const isRemoved = (element: XmlElement) =>
    removed.some(
      (range) => element.start >= range.start && element.end <= range.end,
    )
  for (const element of elements) {
    if (isRemoved(element)) continue
    if (isWord(element, 'hyperlink')) {
      const id = attributeValue(element, RELATIONSHIPS_NAMESPACE, 'id')
      if (id === undefined || detached.get(id) !== 'hyperlink') continue
      if (element.selfClosing) {
        removeElement(element)
        continue
      }
      // Keep the children; drop the wrapper's open and close tags.
      removed.push(
        { start: element.start, end: element.startTagEnd },
        { start: element.endTagStart, end: element.end },
      )
      setOverlayReplacement(overlay, `share-safe:link-open:${element.start}`, {
        start: element.start,
        end: element.startTagEnd,
        value: '',
      })
      setOverlayReplacement(overlay, `share-safe:link-close:${element.start}`, {
        start: element.endTagStart,
        end: element.end,
        value: '',
      })
      part.dirty = true
      continue
    }
    // Attached templates are removed whole wherever they appear (they are
    // only legal inside settings).
    if (isWord(element, 'attachedTemplate')) {
      const id = attributeValue(element, RELATIONSHIPS_NAMESPACE, 'id')
      if (id !== undefined && detached.get(id) === 'attachedTemplate') {
        removeElement(element)
      }
    }
  }
}

/** Rewrites each start tag that carries a provenance attribute. */
function stripProvenanceAttributes(
  part: SourcePart,
  elements: XmlElement[],
  removed: { start: number; end: number }[],
) {
  const overlay = part.overlay
  if (!overlay) return
  for (const element of elements) {
    if (
      removed.some(
        (range) => element.start >= range.start && element.end <= range.end,
      )
    ) {
      continue
    }
    const flagged = element.attributes.filter(isProvenanceAttribute)
    if (flagged.length === 0) continue
    let tag = overlay.source.slice(element.start, element.startTagEnd)
    for (const attribute of flagged) {
      const pattern = new RegExp(
        `\\s${escapeRegExp(attribute.qualifiedName)}\\s*=\\s*("[^"]*"|'[^']*')`,
        'u',
      )
      const next = tag.replace(pattern, '')
      if (next === tag) {
        refuseShareSafe(
          `${part.name} holds a provenance attribute that could not be stripped`,
        )
      }
      tag = next
    }
    setOverlayReplacement(overlay, `share-safe:attrs:${element.start}`, {
      start: element.start,
      end: element.startTagEnd,
      value: tag,
    })
    part.dirty = true
  }
}

/**
 * Removes every child of `docProps/core.xml`'s root — descriptive fields in
 * any namespace, named or not, go whole so nothing rides in an attribute or
 * a foreign-typed element. The root's namespace declarations stay so the
 * part remains a valid core-properties part.
 */
function emptyRootChildren(part: SourcePart, elements: XmlElement[]) {
  const overlay = part.overlay
  if (!overlay) refuseShareSafe(`${part.name} has no parse surface`)
  for (const element of elements) {
    if (element.depth !== 1) continue
    setOverlayReplacement(overlay, `share-safe:${element.start}`, {
      start: element.start,
      end: element.end,
      value: '',
    })
    part.dirty = true
  }
}

/**
 * Rewrites the custom-properties part from scratch: only validated product
 * markings survive, serialised canonically so no foreign attribute, comment
 * or processing instruction rides inside an allowed name. Unknown `obiter.*`
 * names are not this build's markings and are dropped with the rest.
 */
function rewriteCustomProperties(
  document: OoxmlDocument,
  part: SourcePart,
  elements: XmlElement[],
  orphaned: boolean,
) {
  const overlay = part.overlay
  if (!overlay) refuseShareSafe(`${part.name} has no parse surface`)
  const root = elements.find((element) => element.depth === 0)
  if (
    !root ||
    root.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE ||
    root.localName !== 'Properties'
  ) {
    refuseShareSafe('custom properties part is malformed')
  }
  const seen = new Set<string>()
  const kept: string[] = []
  let pid = 2
  for (const element of elements) {
    if (
      element.parent !== root ||
      element.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE ||
      element.localName !== 'property'
    ) {
      continue
    }
    const name = attributeValue(element, '', 'name')
    if (name === undefined || !(name in MARKING_PROPERTY_TYPES)) continue
    if (seen.has(name)) {
      refuseShareSafe(`duplicated marking property ${name}`)
    }
    seen.add(name)
    // SAFETY: the `in` check above admits only the four marking names.
    const type =
      MARKING_PROPERTY_TYPES[name as keyof typeof MARKING_PROPERTY_TYPES]
    const values = elements.filter(
      (candidate) =>
        candidate.parent === element &&
        candidate.namespaceUri === DOC_PROPS_VT_NAMESPACE,
    )
    if (values.length !== 1) {
      refuseShareSafe(`marking property ${name} is malformed`)
    }
    const value = values[0]!
    const text = decodeXmlReferences(
      overlay.source.slice(value.startTagEnd, value.endTagStart),
    ).trim()
    if (type === 'string') {
      if (
        value.localName !== 'lpwstr' &&
        value.localName !== 'lpstr' &&
        value.localName !== 'bstr'
      ) {
        refuseShareSafe(`marking property ${name} has a foreign value type`)
      }
      if (text === '') continue
      kept.push(markingPropertyXml(pid++, name, text))
      continue
    }
    if (value.localName !== 'bool') {
      refuseShareSafe(`marking property ${name} has a foreign value type`)
    }
    const flag = text.toLowerCase()
    if (flag !== 'true' && flag !== 'false' && flag !== '1' && flag !== '0') {
      refuseShareSafe(`marking property ${name} is not a readable flag`)
    }
    kept.push(markingPropertyXml(pid++, name, flag === 'true' || flag === '1'))
  }

  // An orphaned custom.xml adopted for its markings needs the declaration a
  // referenced part carries; a file that never parses as Properties was
  // already refused above.
  if (orphaned) {
    try {
      adoptOrphanedCustomPropertiesPart(document)
    } catch (cause) {
      if (cause instanceof OoxmlError) {
        refuseShareSafe('orphaned custom properties could not be declared')
      }
      throw cause
    }
  }
  setOverlayReplacement(overlay, 'share-safe:rewrite', {
    start: 0,
    end: overlay.source.length,
    value:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Properties xmlns="${CUSTOM_PROPERTIES_NAMESPACE}" xmlns:vt="${DOC_PROPS_VT_NAMESPACE}">` +
      kept.join('') +
      `</Properties>`,
  })
  part.dirty = true
}

const DOC_PROPS_VT_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'

/**
 * Removes relationship declarations whose target was dropped or whose
 * pointer the policy detached, in every kept `.rels` part.
 */
function stripRelationshipElements(
  document: OoxmlDocument,
  plan: ShareSafePlan,
  part: SourcePart,
  elements: XmlElement[],
  droppedParts: Set<string>,
  removeElement: (element: XmlElement) => void,
) {
  const stripIds = plan.stripRelationships.get(part.name) ?? new Set<string>()
  let owner: string
  try {
    owner = relationshipSourcePartName(part.name)
  } catch {
    return
  }
  for (const element of elements) {
    if (
      element.namespaceUri !== PACKAGE_REL_NAMESPACE ||
      element.localName !== 'Relationship'
    ) {
      continue
    }
    const id = attributeValue(element, '', 'Id')
    if (id !== undefined && stripIds.has(id)) {
      removeElement(element)
      continue
    }
    const target = attributeValue(element, '', 'Target')
    const type = attributeValue(element, '', 'Type')
    if (target === undefined || type === undefined) {
      refuseShareSafe(`${part.name} carries an undeclarable relationship`)
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
      removeElement(element)
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
      setOverlayReplacement(overlay, `share-safe:${element.start}`, {
        start: element.start,
        end: element.end,
        value: '',
      })
      part.dirty = true
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
