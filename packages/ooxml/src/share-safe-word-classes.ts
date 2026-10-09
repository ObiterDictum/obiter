import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'

/**
 * The WordprocessingML classification vocabulary the element and attribute
 * verdicts consult: element names whose appearance is a refusal class
 * (revision markup, opaque payloads, external pointers, hiding marks) and
 * the names that resolve to removal or unwrapping (metadata carriers,
 * markers, settings provenance, sdt bindings). Pure data plus the two
 * context-sensitive classifiers — everything here is named before the
 * `w:` allow-list is consulted.
 */

/**
 * Tracked-change and revision markup, the complete element set: wrappers
 * the parser models (`ins`, `del`, `moveFrom`, `moveTo`) plus the shapes it
 * does not — property, table, section, numbering and customXml revisions,
 * move range markers, permission range markers, and the deleted-text
 * carriers that keep redacted text recoverable. Any of them in any part
 * refuses the copy; the attribute-level rule below fails closed on
 * revision markup the name list does not know, since revision elements are
 * the only carriers of `w:author`/`w:date`/`w:ed`/`w:edGrp` in a story.
 */
export const SHARE_SAFE_REVISION_ELEMENTS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'tblPrExChange',
  'numberingChange',
  'numberChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlIns',
  'customXmlDel',
  'customXmlMoveFrom',
  'customXmlMoveTo',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
  'permStart',
  'permEnd',
  'delText',
  'delInstrText',
])

/**
 * Attributes that identify revision markup wherever they appear — on `w:`
 * and on the Word extension namespaces, whose `w14:`/`w15:` revision
 * elements carry the same identity fields.
 */
export const REVISION_IDENTITY_ATTRIBUTES = new Set([
  'author',
  'date',
  'ed',
  'edGrp',
])

/** Payloads this layer cannot inspect — opaque embedded content. */
export const SHARE_SAFE_OPAQUE_ELEMENTS = new Set([
  'altChunk',
  'object',
  'OLEObject',
  'control',
  'subDoc',
  'fldData',
  'binData',
])

/**
 * WordprocessingML frameset machinery — `w:frameset`/`w:frame`/`w:srcFile`
 * declare external document pointers in webSettings. A share-safe copy
 * cannot carry them.
 */
export const SHARE_SAFE_WEB_POINTER_ELEMENTS = new Set([
  'frameset',
  'frame',
  'srcFile',
])

/**
 * Hiding mechanisms: `vanish`/`webHidden`/`specVanish` mark text invisible
 * and `hidden` marks a table row. An explicit off value (`w:val="0"` —
 * Word's way of unhiding) is honest, and a vanish inside paragraph-mark
 * properties (`pPr/rPr`) hides only the pilcrow. Every other occurrence
 * refuses — hidden styling cannot be unwrapped to visible text without
 * guessing at intent.
 */
export const SHARE_SAFE_HIDDEN_ELEMENTS = new Set([
  'vanish',
  'webHidden',
  'specVanish',
  'hidden',
])

const OFF_VALUES = new Set(['0', 'false', 'off'])

function toggleIsOn(element: XmlElement) {
  const value = attributeValue(element, WORD_NAMESPACE, 'val')
  return value === undefined || !OFF_VALUES.has(value.trim().toLowerCase())
}

export function hiddenElementRefuses(element: XmlElement) {
  if (!SHARE_SAFE_HIDDEN_ELEMENTS.has(element.localName)) return false
  if (!toggleIsOn(element)) return false
  // Paragraph-mark properties live at pPr/rPr; vanish there hides only the
  // formatting mark. `hidden` (the row flag) has no such carve-out.
  if (element.localName === 'hidden') return true
  const rPr = element.parent
  return !(rPr && isWord(rPr, 'rPr') && rPr.parent && isWord(rPr.parent, 'pPr'))
}

/**
 * `w:sdt` bookkeeping that binds a content control to document state or a
 * datastore — a customXml binding (`dataBinding`, `customXmlPr`), a glossary
 * pointer (`docPartObj`/`docPartList`/`docPartGallery` and their children),
 * the control's persistent `id` and `tag`, and web-extension provenance.
 * None is visible content; each is removed whole when it sits under an
 * `sdt` control. The names are only bound inside that subtree — `w:id`
 * elsewhere in a story is a different, honest element.
 */
export function isSdtScoped(element: XmlElement) {
  let cursor = element.parent
  while (cursor) {
    if (
      cursor.namespaceUri === WORD_NAMESPACE &&
      (cursor.localName === 'sdt' ||
        cursor.localName === 'sdtPr' ||
        cursor.localName === 'sdtEndPr' ||
        cursor.localName === 'customXml')
    ) {
      return true
    }
    cursor = cursor.parent
  }
  return false
}

/**
 * Control-scope metadata that names visible content — a `tag`, a
 * `placeholder` hint, the control's `id`. Inside a control subtree it is
 * removed; outside one it is a differently-shaped but honest element and
 * keeps.
 */
export const SHARE_SAFE_SDT_IDENTITY_ELEMENTS = new Set([
  'tag',
  'placeholder',
  'id',
])

/**
 * Binding and glossary pointers — `dataBinding`, `customXmlPr`, the
 * `docPart*` carriers, web-extension provenance. Inside a control subtree
 * they are removed; outside one they are a pointer in a context the policy
 * does not recognise, which refuses rather than ships.
 */
export const SHARE_SAFE_SDT_POINTER_ELEMENTS = new Set([
  'dataBinding',
  'customXmlPr',
  'docPartObj',
  'docPartList',
  'docPartGallery',
  'docPartCategory',
  'docPartUnique',
  'webExtensionCreated',
  'webExtensionLinked',
])

/**
 * Wrappers whose entire purpose is binding or smart-tag metadata — the
 * element goes, its children (the visible text) stay.
 */
export const SHARE_SAFE_UNWRAP_ELEMENTS = new Set(['smartTag', 'customXml'])

/**
 * Comment surface markers left in a story once the comments part is gone —
 * removed whole wherever they appear.
 */
export const SHARE_SAFE_COMMENT_MARKERS = new Set([
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'annotationRef',
])

/**
 * Settings elements that carry provenance, tracking state or fetchable
 * pointers: tracking mode must not transfer to the recipient; `docVars`,
 * `rsids` and `writeReservation` are edit provenance; a schema library,
 * attached schema/template, save-through XSLT or mail-merge declaration is
 * an external reference; `documentProtection` carries lock credentials;
 * `savePreviewPicture` keeps a thumbnail alive; `smartTagType` declares
 * smart-tag provenance; `shapeDefaults`/`hdrShapeDefaults` wrap VML shape
 * defaults (the `o:`/`v:` surface) the copy does not carry. Word-extension
 * elements in settings (`w14:docId` and friends) are product state by
 * definition and go with them.
 */
export const SHARE_SAFE_SETTINGS_REMOVE = new Set([
  'trackRevisions',
  'docVars',
  'rsids',
  'attachedSchema',
  'attachedTemplate',
  'mailMerge',
  'savePreviewPicture',
  'writeReservation',
  'documentProtection',
  'schemaLibrary',
  'smartTagType',
  'saveThroughXslt',
  'shapeDefaults',
  'hdrShapeDefaults',
])
