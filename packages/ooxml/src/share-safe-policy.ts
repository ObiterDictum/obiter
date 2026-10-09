import { RELATIONSHIPS_NAMESPACE } from './structure-xml'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'
import {
  CONTENT_TYPE_ATTRIBUTES,
  CONTENT_TYPES_NAMESPACE,
  isEmbeddedNamespace,
  isWordExtensionNamespace,
  MARKUP_COMPAT_NAMESPACE,
  PACKAGE_REL_NAMESPACE,
  RELATIONSHIP_ATTRIBUTES,
  XML_NAMESPACE_URI,
  type ShareSafePartDisposition,
  type ShareSafePartFamily,
} from './share-safe-parts'

/**
 * The element-level half of the share-safe policy: what may exist inside a
 * kept part once its root and part family are proven. Element names that
 * carry revision markup, hidden content, opaque payloads or external
 * pointers refuse; metadata elements are removed or unwrapped; attributes
 * carry a per-element disposition. Scan, transform and verifier all run on
 * this one vocabulary.
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

/** Attributes that identify revision markup wherever it appears. */
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
const ON_VALUES = new Set(['1', 'true', 'on'])

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
 * pointer (`docPartObj`/`docPartList`/`docPartGallery`, `placeholder`), the
 * control's persistent `id` and `tag`, and web-extension provenance. None
 * is visible content; each is removed whole when it sits under an `sdt`
 * control. The names are only bound inside that subtree — `w:id` elsewhere
 * in a story is a different, honest element.
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
 * Control-scope metadata that names visible content — a `tag`, a `placeholder`
 * hint, the control's `id`. Inside a control subtree it is removed; outside
 * one it is a differently-shaped but honest element and keeps.
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
  'webExtensionCreated',
  'webExtensionLinked',
])

/**
 * Wrappers whose entire purpose is binding or smart-tag metadata — the
 * element goes, its children (the visible text) stay.
 */
export const SHARE_SAFE_UNWRAP_ELEMENTS = new Set(['smartTag', 'customXml'])

/**
 * Settings elements that carry provenance, tracking state or fetchable
 * pointers: tracking mode must not transfer to the recipient; `docVars`,
 * `rsids` and `writeReservation` are edit provenance; a schema library,
 * attached schema/template, save-through XSLT or mail-merge declaration is
 * an external reference; `documentProtection` carries lock credentials;
 * `savePreviewPicture` keeps a thumbnail alive; `smartTagType` declares
 * smart-tag provenance. Word-extension elements in settings (`w14:docId`
 * and friends) are product state by definition and go with them.
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
])

/** `wp:docPr`/`a:cNvPr` — the non-visual carriers of drawing metadata. */
export const DOCUMENT_OBJECT_PROPS_ELEMENTS = new Set(['docPr', 'cNvPr'])

/** `descr`/`title`/`name` on a drawing object are descriptive metadata. */
const DOCUMENT_OBJECT_PROPS_ATTRIBUTES = new Set(['descr', 'title', 'name'])

/**
 * Field instructions the copy may carry: every name here is bounded to
 * document content — computed values, in-document references, index/TOC/TA
 * marking, form fields and the `=` formula. Nothing on the list accepts an
 * argument that addresses content outside the package. Anything absent —
 * merge fields, property lookups, `INCLUDETEXT`-style fetchers, `PRIVATE`
 * payloads, names this build does not know — refuses.
 */
export const SHARE_SAFE_FIELD_NAMES = new Set([
  'ADVANCE',
  'AUTONUM',
  'AUTONUMLGL',
  'AUTONUMOUT',
  'CREATEDATE',
  'DATE',
  'EDITTIME',
  'EQ',
  'FILENAME',
  'FORMCHECKBOX',
  'FORMDROPDOWN',
  'FORMTEXT',
  'GOTOBUTTON',
  'IF',
  'INDEX',
  'LISTNUM',
  'NOTEREF',
  'NUMCHARS',
  'NUMPAGES',
  'NUMWORDS',
  'PAGE',
  'PAGEREF',
  'PRINTDATE',
  'QUOTE',
  'REF',
  'SAVEDATE',
  'SECTION',
  'SECTIONPAGES',
  'SEQ',
  'SET',
  'STYLEREF',
  'SYMBOL',
  'TA',
  'TC',
  'TIME',
  'TOA',
  'TOC',
  'XE',
])

/** Field names that refuse as payloads rather than pointers. */
export const SHARE_SAFE_OPAQUE_FIELDS = new Set(['EMBED', 'PRIVATE'])

/** The `=` formula field is written as `{ =… }` with no field name. */
export function isFormulaFieldInstruction(instruction: string) {
  return instruction.trimStart().startsWith('=')
}

export type ShareSafeElementVerdict = 'keep' | 'remove' | 'unwrap' | 'refuse'

/**
 * What the policy does with an element, given the part's family and
 * disposition. `'remove'` and `'unwrap'` are transforms — the verifier
 * treats either surviving in the output as residue.
 */
export function shareSafeElementVerdict(
  element: XmlElement,
  family: ShareSafePartFamily,
  dispositionKind: ShareSafePartDisposition['kind'],
): ShareSafeElementVerdict {
  if (element.namespaceUri !== WORD_NAMESPACE) {
    // Word-extension elements inside settings are product state (docId and
    // friends); the transform removes them whole.
    if (
      dispositionKind === 'scrub-settings' &&
      isWordExtensionNamespace(element.namespaceUri)
    ) {
      return 'remove'
    }
    return 'keep'
  }
  if (
    SHARE_SAFE_REVISION_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_OPAQUE_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_WEB_POINTER_ELEMENTS.has(element.localName) ||
    hiddenElementRefuses(element)
  ) {
    return 'refuse'
  }
  if (
    dispositionKind === 'scrub-settings' &&
    SHARE_SAFE_SETTINGS_REMOVE.has(element.localName)
  ) {
    return 'remove'
  }
  if (family === 'word') {
    const sdtScoped = isSdtScoped(element)
    if (SHARE_SAFE_SDT_POINTER_ELEMENTS.has(element.localName)) {
      return sdtScoped ? 'remove' : 'refuse'
    }
    if (sdtScoped && SHARE_SAFE_SDT_IDENTITY_ELEMENTS.has(element.localName)) {
      return 'remove'
    }
  }
  if (SHARE_SAFE_UNWRAP_ELEMENTS.has(element.localName)) return 'unwrap'
  return 'keep'
}

/** Whether `element` sits inside a subtree the transform removes whole. */
export function isPolicyRemovedSubtree(
  element: XmlElement,
  family: ShareSafePartFamily,
  dispositionKind: ShareSafePartDisposition['kind'],
) {
  let cursor: XmlElement | undefined = element
  while (cursor) {
    if (shareSafeElementVerdict(cursor, family, dispositionKind) === 'remove')
      return true
    cursor = cursor.parent
  }
  return false
}

/** Unqualified attribute names that are pointer-shaped and never schema. */
const UNQUALIFIED_POINTER_ATTRIBUTES = new Set(['href', 'src', 'relid'])

export type ShareSafeAttributeVerdict =
  | 'keep'
  | 'strip'
  | 'relationship-pointer'
  | 'refuse-hidden'
  | 'refuse-revision'

/**
 * What the policy does with an attribute. Revision identity
 * (`w:author`/`w:date`/`w:ed`/`w:edGrp`) refuses wherever it appears — those
 * names exist only on revision markup, so the attribute fails closed even
 * on an element the name list does not know. Relationship-namespace
 * attributes resolve against the part's declared relationships by the
 * caller; `wp:docPr`/`cNvPr` descriptive and `hidden` attributes are
 * handled element-scoped; `Relationship` and content-type elements carry
 * only their bounded attribute names. `rsid*` session ids,
 * `w:displacedByCustomXml`, Word-extension `*Id` correlators,
 * foreign-namespace attributes and unqualified pointer-shaped names strip
 * as non-semantic metadata.
 */
export function shareSafeAttributeVerdict(
  element: XmlElement,
  attribute: XmlAttribute,
): ShareSafeAttributeVerdict {
  if (
    attribute.namespaceUri === WORD_NAMESPACE &&
    REVISION_IDENTITY_ATTRIBUTES.has(attribute.localName)
  ) {
    return 'refuse-revision'
  }
  if (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE) {
    return 'relationship-pointer'
  }
  if (
    DOCUMENT_OBJECT_PROPS_ELEMENTS.has(element.localName) &&
    attribute.namespaceUri === ''
  ) {
    if (attribute.localName === 'hidden') {
      return ON_VALUES.has(attribute.value.trim().toLowerCase())
        ? 'refuse-hidden'
        : 'strip'
    }
    if (DOCUMENT_OBJECT_PROPS_ATTRIBUTES.has(attribute.localName)) {
      return 'strip'
    }
    return 'keep'
  }
  if (
    element.namespaceUri === PACKAGE_REL_NAMESPACE &&
    element.localName === 'Relationship'
  ) {
    return attribute.namespaceUri === '' &&
      RELATIONSHIP_ATTRIBUTES.has(attribute.localName)
      ? 'keep'
      : 'strip'
  }
  if (element.namespaceUri === CONTENT_TYPES_NAMESPACE) {
    const allowed = CONTENT_TYPE_ATTRIBUTES.get(element.localName)
    if (allowed !== undefined) {
      return attribute.namespaceUri === '' && allowed.has(attribute.localName)
        ? 'keep'
        : 'strip'
    }
  }
  if (attribute.namespaceUri === WORD_NAMESPACE) {
    if (attribute.localName.toLowerCase().startsWith('rsid')) return 'strip'
    if (attribute.localName === 'displacedByCustomXml') return 'strip'
    return 'keep'
  }
  if (attribute.namespaceUri === '') {
    return UNQUALIFIED_POINTER_ATTRIBUTES.has(attribute.localName.toLowerCase())
      ? 'strip'
      : 'keep'
  }
  if (
    attribute.namespaceUri === XML_NAMESPACE_URI ||
    attribute.namespaceUri === MARKUP_COMPAT_NAMESPACE
  ) {
    return 'keep'
  }
  if (isWordExtensionNamespace(attribute.namespaceUri)) {
    return attribute.localName.endsWith('Id') ? 'strip' : 'keep'
  }
  if (isEmbeddedNamespace(attribute.namespaceUri)) return 'keep'
  // A foreign-namespace attribute is metadata no consumer resolves — the
  // canonical strip drops it rather than guessing at a pointer.
  return 'strip'
}
