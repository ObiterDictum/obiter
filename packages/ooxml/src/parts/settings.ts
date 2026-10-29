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

export function writeTrackRevisions(document: OoxmlDocument, on: boolean) {
  const declared = document.model.relationships.filter(settingsRelationship)
  if (declared.length > 1) {
    if (on) throw settingsError()
    return
  }
  const relationship = declared[0]
  const target = relationship
    ? resolveRelationshipTarget(relationship)
    : undefined
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
  if (!found) {
    if (on) throw settingsError()
    return
  }
  const { root, children, toggles } = found
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

function guardSettings<T>(make: () => T): T {
  try {
    return make()
  } catch (cause) {
    if (cause instanceof OoxmlError) throw settingsError()
    throw cause
  }
}
