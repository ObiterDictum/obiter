import type { OoxmlDocument, SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_PART,
} from './parts/custom-properties'
import {
  createXmlOverlay,
  parseXmlElements,
  setOverlayReplacement,
} from './parts/overlay'
import {
  relationshipSourcePartName,
  resolveRelationshipTarget,
} from './parts/rels'
import {
  attributeValue,
  isDescendantOf,
  isWord,
  nearestWordAncestor,
  type XmlElement,
} from './parts/xml-elements'
import { parseDocx } from './parse'
import { serialiseDocx } from './serialise'

const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'

const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * Raised when a package cannot be proven free of private or ambiguous
 * material for sharing. The route maps it to `share_safe_export_refused`;
 * nothing is emitted in that case.
 */
export class ShareSafeRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareSafeRefusal'
  }
}

/**
 * The bounded share-safe policy. Everything outside it is either removed and
 * verified below, or refused.
 *
 * Refused (the package would keep material this build cannot prove clean):
 *  - tracked changes: deleted text stays recoverable inside `w:del`, and
 *    auto-accepting or auto-rejecting would guess at legal content;
 *  - hidden runs (`w:vanish`, `w:webHidden`): hidden text is a classic leak,
 *    and field marks (e.g. a table-of-authorities mark) share the markup, so
 *    removal cannot be scoped safely;
 *  - embedded objects, ActiveX controls and `w:altChunk` inclusions: opaque
 *    payloads this layer cannot inspect;
 *  - any part the scrub below could not remove cleanly.
 *
 * Removed then verified against a re-parse of the finished bytes:
 *  - comment parts (`comments.xml`, `commentsExtended.xml`, `people.xml`)
 *    together with their relationships, content-type overrides and every
 *    `w:commentRangeStart`/`w:commentRangeEnd`/`w:commentReference` marker;
 *  - authorship and descriptive metadata in `docProps/core.xml` and
 *    `docProps/app.xml` (creator, lastModifiedBy, title, subject, keywords,
 *    description, category, contentStatus, company, manager, template);
 *  - `w:trackRevisions` in `word/settings.xml` — a recipient must not
 *    inherit tracking mode;
 *  - every foreign `docProps/custom.xml` property — the product's own
 *    `obiter.*` markings stay, because they are the user's chosen labels;
 *  - `docProps/thumbnail.*` — a stale first-page preview.
 */
export async function buildShareSafeDocx(
  document: OoxmlDocument,
): Promise<Uint8Array> {
  assertShareable(document)
  const removedParts = stripCommentSurface(document)
  stripPackageMetadata(document)
  stripTrackingMode(document)
  scrubCustomProperties(document)
  dropParts(document, removedParts)
  const bytes = await serialiseDocx(document)
  await assertShareSafePackage(bytes)
  return bytes
}

function refuse(reason: string): never {
  throw new ShareSafeRefusal(reason)
}

function assertShareable(document: OoxmlDocument) {
  if (document.trackedChanges.size > 0) {
    refuse('tracked changes remain in the document')
  }
  for (const [name, part] of document.sourceParts) {
    if (
      /(^|\/)embeddings\//u.test(name) ||
      /(^|\/)activex\//iu.test(name) ||
      /(^|\/)afchunk/iu.test(name)
    ) {
      refuse(`package part ${name} cannot be verified`)
    }
    if (part.kind === 'binary' && !isImagePart(document, name)) {
      // Binary parts whose relationship declares an image are content, not
      // leakage; OLE objects, embeddings and ActiveX are unverifiable.
      refuse(`package part ${name} cannot be verified`)
    }
  }
  for (const relationship of document.model.relationships) {
    const tail = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (tail === 'oleObject' || tail === 'control' || tail === 'aFChunk') {
      refuse(`relationship ${tail} carries unverifiable content`)
    }
  }
  for (const part of document.sourceParts.values()) {
    if (part.role !== 'story') continue
    const overlay = part.overlay
    if (!overlay) refuse(`story part ${part.name} has no parse surface`)
    if (overlay.replacements.size > 0) {
      refuse(`story part ${part.name} already carries edits`)
    }
    for (const element of parseXmlElements(overlay.source)) {
      if (isWord(element, 'altChunk')) {
        refuse('document includes external content (w:altChunk)')
      }
      if (
        (isWord(element, 'vanish') || isWord(element, 'webHidden')) &&
        nearestWordAncestor(element, 'r')
      ) {
        // Hidden styling on anything other than a run (e.g. paragraph-mark
        // properties) hides formatting marks, not content, and is kept.
        refuse('document contains hidden text')
      }
    }
  }
}

function isImagePart(document: OoxmlDocument, partName: string) {
  return document.model.relationships.some(
    (relationship) =>
      relationship.type.endsWith('/image') &&
      resolveRelationshipTarget(relationship) === partName,
  )
}

/**
 * Deletes the comment parts and every in-story comment marker. The returned
 * part-name set also drives relationship and content-type cleanup; a marker
 * outside the recognised shapes fails closed.
 */
function stripCommentSurface(document: OoxmlDocument): Set<string> {
  const removed = new Set<string>()
  for (const relationship of document.model.relationships) {
    const tail = relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
    if (
      tail === 'comments' ||
      tail === 'commentsExtended' ||
      tail === 'people'
    ) {
      const target = resolveRelationshipTarget(relationship)
      if (!target) refuse('comment relationship target is unresolvable')
      removed.add(target)
    }
  }
  for (const name of removed) {
    if (!document.sourceParts.has(name)) {
      refuse(`declared comment part ${name} is missing`)
    }
  }

  for (const part of document.sourceParts.values()) {
    if (part.role !== 'story' || removed.has(part.name)) continue
    const overlay = part.overlay
    if (!overlay) refuse(`story part ${part.name} has no parse surface`)
    const elements = parseXmlElements(overlay.source)
    for (const element of elements) {
      if (
        isWord(element, 'commentRangeStart') ||
        isWord(element, 'commentRangeEnd')
      ) {
        removeElement(part, element)
        continue
      }
      if (!isWord(element, 'commentReference')) continue
      const run = nearestWordAncestor(element, 'r')
      if (!run) refuse('unanchored comment reference')
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
      removeElement(part, carriesContent ? element : run)
    }
  }
  return removed
}

function removeElement(part: SourcePart, element: XmlElement) {
  const overlay = part.overlay
  if (!overlay) return
  setOverlayReplacement(overlay, `share-safe:${element.start}`, {
    start: element.start,
    end: element.end,
    value: '',
  })
  part.dirty = true
}

/**
 * Empties the free-text authorship fields in core/app properties. Element
 * ranges come from the real parser, so values containing markup-shaped text
 * cannot escape the scrub. Unknown elements are preserved — the policy only
 * clears the fields known to carry names and descriptions.
 */
function stripPackageMetadata(document: OoxmlDocument) {
  const scrub = {
    'docProps/core.xml': [
      'creator',
      'lastModifiedBy',
      'title',
      'subject',
      'keywords',
      'description',
      'category',
      'contentStatus',
    ],
    'docProps/app.xml': ['Company', 'Manager', 'Template'],
  }
  for (const [partName, names] of Object.entries(scrub)) {
    const part = document.sourceParts.get(partName)
    if (!part || part.kind !== 'xml') continue
    const overlay = ensureOverlay(part)
    for (const element of parseXmlElements(overlay.source)) {
      if (element.depth === 0 || element.selfClosing) continue
      if (!names.includes(element.localName)) continue
      setOverlayReplacement(overlay, `share-safe:${element.start}`, {
        start: element.startTagEnd,
        end: element.endTagStart,
        value: '',
      })
      part.dirty = true
    }
  }
}

/** Removes `w:trackRevisions` so the shared copy opens untracked. */
function stripTrackingMode(document: OoxmlDocument) {
  const part = document.sourceParts.get('word/settings.xml')
  if (!part || part.kind !== 'xml') return
  const overlay = ensureOverlay(part)
  for (const element of parseXmlElements(overlay.source)) {
    if (isWord(element, 'trackRevisions')) {
      removeElement(part, element)
    }
  }
}

/** Keeps only the product's `obiter.*` properties in custom.xml. */
function scrubCustomProperties(document: OoxmlDocument) {
  const part = document.sourceParts.get(CUSTOM_PROPERTIES_PART)
  if (!part || part.kind !== 'xml') return
  const overlay = ensureOverlay(part)
  const elements = parseXmlElements(overlay.source)
  const root = elements.find(({ depth }) => depth === 0)
  if (!root || root.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE) {
    refuse('custom properties part is malformed')
  }
  for (const element of elements) {
    if (
      element.parent !== root ||
      element.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE ||
      element.localName !== 'property'
    ) {
      continue
    }
    const name = attributeValue(element, '', 'name')
    if (name === undefined || !name.startsWith('obiter.')) {
      removeElement(part, element)
    }
  }
}

/**
 * Removes parts outright and strips their relationship declarations and
 * content-type overrides everywhere they appear, so no dangling pointer into
 * a deleted part survives. Thumbnails join the removal set here.
 */
function dropParts(document: OoxmlDocument, removedParts: Set<string>) {
  for (const name of document.sourceParts.keys()) {
    if (/^docProps\/thumbnail\./iu.test(name)) removedParts.add(name)
    // A digital signature over the original bytes is void once sanitised;
    // shipping it would imply a provenance the copy no longer has.
    if (/^_xmlsignatures\//iu.test(name)) removedParts.add(name)
  }
  // A `.rels` part belongs to the part it is named after; a rels part whose
  // owner was removed leaves a dangling declarations file.
  for (const name of document.sourceParts.keys()) {
    if (
      name.endsWith('.rels') &&
      removedParts.has(relationshipSourcePartName(name))
    ) {
      removedParts.add(name)
    }
  }
  for (const name of removedParts) document.sourceParts.delete(name)

  for (const part of document.sourceParts.values()) {
    if (!part.name.endsWith('.rels') || part.kind !== 'xml') continue
    const overlay = ensureOverlay(part)
    for (const element of parseXmlElements(overlay.source)) {
      if (
        element.namespaceUri !== RELATIONSHIPS_NAMESPACE ||
        element.localName !== 'Relationship'
      ) {
        continue
      }
      const target = attributeValue(element, '', 'Target')
      if (target === undefined) refuse('relationship without target')
      const resolved = resolveRelationshipTarget({
        sourcePartName: relationshipSourcePartName(part.name),
        id: attributeValue(element, '', 'Id') ?? '',
        type: attributeValue(element, '', 'Type') ?? '',
        target,
        ...(attributeValue(element, '', 'TargetMode') !== undefined
          ? { targetMode: attributeValue(element, '', 'TargetMode') }
          : {}),
        sourceFragment: '',
      })
      if (resolved !== undefined && removedParts.has(resolved)) {
        removeElement(part, element)
      }
    }
  }

  const contentTypes = document.sourceParts.get('[Content_Types].xml')
  if (contentTypes && contentTypes.kind === 'xml') {
    const overlay = ensureOverlay(contentTypes)
    for (const element of parseXmlElements(overlay.source)) {
      if (
        element.namespaceUri !== CONTENT_TYPES_NAMESPACE ||
        element.localName !== 'Override'
      ) {
        continue
      }
      const partName = attributeValue(element, '', 'PartName')
      if (partName === undefined) continue
      if (removedParts.has(partName.replace(/^\//u, ''))) {
        removeElement(contentTypes, element)
      }
    }
  }
}

/**
 * The verification half of the policy: re-parse the finished archive and
 * prove the refused classes are gone rather than trusting the removals ran.
 */
async function assertShareSafePackage(bytes: Uint8Array) {
  let reparsed: OoxmlDocument
  try {
    reparsed = await parseDocx(bytes)
  } catch {
    refuse('sanitised package failed to re-parse')
  }
  if (reparsed.trackedChanges.size > 0 || reparsed.model.changes.length > 0) {
    refuse('tracked changes survived sanitisation')
  }
  if (reparsed.model.comments.length > 0) {
    refuse('comments survived sanitisation')
  }
  for (const name of reparsed.sourceParts.keys()) {
    if (
      /(^|\/)comments[^/]*\.xml$/iu.test(name) ||
      /(^|\/)people\.xml$/iu.test(name) ||
      /^docProps\/thumbnail\./iu.test(name) ||
      /^_xmlsignatures\//iu.test(name)
    ) {
      refuse(`comment or preview part ${name} survived sanitisation`)
    }
  }
  for (const part of reparsed.sourceParts.values()) {
    if (part.role !== 'story' || !part.overlay) continue
    for (const element of parseXmlElements(part.overlay.source)) {
      if (isWord(element, 'commentReference')) {
        refuse('comment marker survived sanitisation')
      }
      if (isWord(element, 'vanish') || isWord(element, 'webHidden')) {
        refuse('hidden content survived sanitisation')
      }
    }
  }
  const settings = reparsed.sourceParts.get('word/settings.xml')
  if (settings?.kind === 'xml' && settings.overlay) {
    for (const element of parseXmlElements(settings.overlay.source)) {
      if (isWord(element, 'trackRevisions')) {
        refuse('tracking mode survived sanitisation')
      }
    }
  }
  // authorship fields verified at XML level: the model does not carry them.
  const checks: Array<[string, readonly string[]]> = [
    ['docProps/core.xml', ['creator', 'lastModifiedBy']],
    ['docProps/app.xml', ['Company']],
  ]
  for (const [partName, names] of checks) {
    const part = reparsed.sourceParts.get(partName)
    if (!part || part.kind !== 'xml' || !part.overlay) continue
    for (const element of parseXmlElements(part.overlay.source)) {
      if (!names.includes(element.localName)) continue
      if (element.endTagStart > element.startTagEnd) {
        refuse(`${partName} kept identifying metadata`)
      }
    }
  }
}

function ensureOverlay(part: SourcePart) {
  if (part.overlay) return part.overlay
  if (part.kind !== 'xml') refuse(`${part.name} is not XML`)
  try {
    part.overlay = createXmlOverlay(decoder.decode(part.originalPayload))
  } catch {
    refuse(`${part.name} is not decodable UTF-8`)
  }
  if (!part.overlay) refuse(`${part.name} has no parse surface`)
  return part.overlay
}
