import {
  ensureContentTypeOverride,
  ensureDocumentRelationship,
  insertRootChild,
} from '../comments-package-parts'
import { OoxmlError, type OoxmlDocument, type SourcePart } from '../model'
import type { DocumentRelationshipWire } from '@obiter/contracts'
import {
  createXmlOverlay,
  parseXmlElements,
  serialiseOverlay,
  setOverlayReplacement,
} from './overlay'
import { resolveRelationshipTarget } from './rels'
import { attributeValue, WORD_NAMESPACE, type XmlElement } from './xml-elements'

const SETTINGS_PART = 'word/settings.xml'
const SETTINGS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings'
const SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * The `CT_Settings` children the schema orders before `w:trackRevisions`
 * (ECMA-376 §17.15.1.78). A child outside this list — a later element or an
 * extension element — is a successor: the toggle is inserted ahead of the
 * first one so Word does not silently drop it.
 */
const TRACK_REVISIONS_PREDECESSORS = new Set([
  'writeProtection',
  'view',
  'zoom',
  'removePersonalInformation',
  'removeDateAndTime',
  'doNotDisplayPageBoundaries',
  'displayBackgroundShape',
  'printPostScriptOverText',
  'printFractionalCharacterWidth',
  'printFormsData',
  'embedTrueTypeFonts',
  'embedSystemFonts',
  'saveSubsetFonts',
  'saveFormsData',
  'mirrorMargins',
  'alignBordersAndEdges',
  'bordersDoNotSurroundHeader',
  'bordersDoNotSurroundFooter',
  'gutterAtTop',
  'hideSpellingErrors',
  'hideGrammaticalErrors',
  'activeWritingStyle',
  'proofState',
  'formsDesign',
  'attachedTemplate',
  'linkStyles',
  'stylePaneFormatFilter',
  'stylePaneSortMethod',
  'documentType',
  'mailMerge',
  'revisionView',
])

function settingsError() {
  return new OoxmlError('invalid-document-edit')
}

function settingsRelationship(relationship: DocumentRelationshipWire) {
  return (
    relationship.sourcePartName === 'word/document.xml' &&
    relationship.type === SETTINGS_RELATIONSHIP
  )
}

/**
 * The settings part a document declares, or the file at the conventional
 * name when it is carried undeclared. Reads tolerate both because a
 * conventional `word/settings.xml` with no relationship is what existing
 * packages in the wild — and this package's own fixtures — hold.
 */
function settingsPart(
  relationships: readonly DocumentRelationshipWire[],
  sourceParts: ReadonlyMap<string, SourcePart>,
) {
  const declared = relationships.filter(settingsRelationship)
  if (declared.length > 1) return undefined
  const relationship = declared[0]
  const target = relationship
    ? resolveRelationshipTarget(relationship)
    : undefined
  const partName = target ?? SETTINGS_PART
  const part = sourceParts.get(partName)
  return part && part.kind === 'xml' ? part : undefined
}

function trackRevisionElements(xml: string) {
  const elements = parseXmlElements(xml)
  const roots = elements.filter(({ depth }) => depth === 0)
  const root = roots[0]
  if (
    roots.length !== 1 ||
    !root ||
    root.namespaceUri !== WORD_NAMESPACE ||
    root.localName !== 'settings'
  ) {
    return undefined
  }
  const children = elements.filter((element) => element.parent === root)
  return {
    root,
    children,
    toggles: children.filter(
      (element) =>
        element.namespaceUri === WORD_NAMESPACE &&
        element.localName === 'trackRevisions',
    ),
  }
}

function onOff(element: XmlElement) {
  const value = attributeValue(element, WORD_NAMESPACE, 'val')
  return value === undefined
    ? true
    : !['false', '0', 'off'].includes(value.toLowerCase())
}

/**
 * Whether the package's `word/settings.xml` records tracked revisions: a
 * `w:trackRevisions` toggle that is present and not explicitly `w:val`-off.
 * An absent, undeclared or malformed part reads as off — the flag is a
 * convenience default for the editor, not content a missing answer should
 * block a document over.
 */
export function readTrackRevisions(source: {
  model: Pick<OoxmlDocument['model'], 'relationships'>
  sourceParts: ReadonlyMap<string, SourcePart>
}) {
  const part = settingsPart(source.model.relationships, source.sourceParts)
  if (!part) return false
  try {
    const found = trackRevisionElements(decoder.decode(part.originalPayload))
    const toggle = found?.toggles[0]
    return toggle ? onOff(toggle) : false
  } catch {
    return false
  }
}

/**
 * Persists the Track Changes toggle: `on` writes a bare `w:trackRevisions`
 * into `word/settings.xml` — creating the part, its `word/document.xml`
 * relationship and its content-type override when absent — and `off` strips
 * every copy a reader could see. A part, relationship or content-type
 * declaration is only touched when a write actually follows, and an
 * unreadable or undeclared part blocks only the `on` path, so a package the
 * toggle does not change stays byte-identical.
 */
export function writeTrackRevisions(document: OoxmlDocument, on: boolean) {
  const declared = document.model.relationships.filter(settingsRelationship)
  // Duplicate settings relationships name an ambiguous part: `on` cannot
  // guess which one a reader honours, while `off` cannot strip a toggle it
  // cannot locate — and neither should rewrite declarations it cannot audit.
  if (declared.length > 1) {
    if (on) throw settingsError()
    return
  }
  const relationship = declared[0]
  const target = relationship
    ? resolveRelationshipTarget(relationship)
    : undefined
  // The off path writes nothing it cannot locate: a missing, undeclared or
  // unreadable part holds no visible toggle, so the package — declarations
  // included — stays byte-identical. Only a requested `on` fails closed on
  // the shapes it cannot honestly write.
  if (relationship && !target) {
    if (on) throw settingsError()
    return
  }
  const part = target
    ? document.sourceParts.get(target)
    : document.sourceParts.get(SETTINGS_PART)
  if (!part) {
    if (!on) return
    if (relationship) throw settingsError()
    createSettingsPart(document)
    return
  }
  if (part.kind !== 'xml') {
    if (on) throw settingsError()
    return
  }
  if (!part.overlay) {
    try {
      part.overlay = createXmlOverlay(decoder.decode(part.originalPayload))
    } catch {
      if (on) throw settingsError()
      return
    }
  }
  let overlay = part.overlay
  if (!overlay) throw settingsError()
  // A second toggle write on one parsed document must see the first write's
  // elements, not only the original XML: pending replacements are
  // source-coordinate edits invisible to the element scan, so a dirty overlay
  // is rebased onto its serialised text before this write's edits are placed.
  if (overlay.replacements.size > 0) {
    overlay = createXmlOverlay(serialiseOverlay(overlay))
    part.overlay = overlay
  }
  let found: ReturnType<typeof trackRevisionElements>
  try {
    found = trackRevisionElements(overlay.source)
  } catch {
    found = undefined
  }
  // A part that is not a single w:settings root holds no readable toggle;
  // stripping one would guess at malformed markup, so only `on` fails closed.
  if (!found) {
    if (on) throw settingsError()
    return
  }
  const { root, children, toggles } = found
  // An unprefixed root declares the Word namespace as its default: the
  // element must land unprefixed too — a `w:` written there binds to nothing.
  const prefix = root.qualifiedName.includes(':')
    ? `${root.qualifiedName.slice(0, root.qualifiedName.indexOf(':'))}:`
    : ''
  const element = `<${prefix}trackRevisions/>`

  if (!on) {
    if (toggles.length === 0) return
    for (const [index, toggle] of toggles.entries()) {
      setOverlayReplacement(overlay, `settings:trackRevisions:${index}`, {
        start: toggle.start,
        end: toggle.end,
        value: '',
      })
    }
    part.dirty = true
    return
  }

  // A part carried undeclared is invisible to Word: a write it holds lands
  // only once the relationship and the content type name it.
  if (!target) {
    const partName = part.name
    guardSettings(() =>
      ensureDocumentRelationship(document, partName, SETTINGS_RELATIONSHIP),
    )
    guardSettings(() =>
      ensureContentTypeOverride(document, partName, SETTINGS_CONTENT_TYPE),
    )
  }
  if (toggles.length === 1 && onOff(toggles[0]!)) return
  // Normalise to exactly one bare toggle: extras are duplicates a malformed
  // part could carry, and an explicit `w:val="false"` is rewritten rather
  // than patched attribute-wise so the persisted form stays canonical.
  const keep = toggles[0]
  if (keep) {
    setOverlayReplacement(overlay, 'settings:trackRevisions:0', {
      start: keep.start,
      end: keep.end,
      value: element,
    })
    for (const [index, duplicate] of toggles.slice(1).entries()) {
      setOverlayReplacement(overlay, `settings:trackRevisions:${index + 1}`, {
        start: duplicate.start,
        end: duplicate.end,
        value: '',
      })
    }
    part.dirty = true
    return
  }
  const before = children.find(
    (child) =>
      child.namespaceUri !== WORD_NAMESPACE ||
      !TRACK_REVISIONS_PREDECESSORS.has(child.localName),
  )
  if (before) {
    setOverlayReplacement(overlay, 'settings:trackRevisions:insert', {
      start: before.start,
      end: before.start,
      value: element,
    })
    part.dirty = true
    return
  }
  guardSettings(() =>
    insertRootChild(part, overlay, 'settings:trackRevisions', root, element),
  )
}

function createSettingsPart(document: OoxmlDocument) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NAMESPACE}"><w:trackRevisions/></w:settings>`
  const part: SourcePart = {
    name: SETTINGS_PART,
    kind: 'xml',
    role: 'opaque',
    originalPayload: encoder.encode(xml),
    dirty: false,
    overlay: createXmlOverlay(xml),
    trackedChanges: [],
  }
  document.sourceParts.set(SETTINGS_PART, part)
  guardSettings(() =>
    ensureDocumentRelationship(document, SETTINGS_PART, SETTINGS_RELATIONSHIP),
  )
  guardSettings(() =>
    ensureContentTypeOverride(document, SETTINGS_PART, SETTINGS_CONTENT_TYPE),
  )
  return part
}

/**
 * The shared part helpers report every structural failure as
 * `comment-export-failed`. In this part that code would mislabel a settings
 * problem, so the calls run inside the narrowest conversion the error type
 * allows.
 */
function guardSettings<T>(make: () => T): T {
  try {
    return make()
  } catch (cause) {
    if (cause instanceof OoxmlError) throw settingsError()
    throw cause
  }
}
