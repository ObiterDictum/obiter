import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'

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

export const REVISION_IDENTITY_ATTRIBUTES = new Set([
  'author',
  'date',
  'ed',
  'edGrp',
])

export const SHARE_SAFE_OPAQUE_ELEMENTS = new Set([
  'altChunk',
  'object',
  'OLEObject',
  'control',
  'subDoc',
  'fldData',
  'binData',
])

export const SHARE_SAFE_WEB_POINTER_ELEMENTS = new Set([
  'frameset',
  'frame',
  'srcFile',
])

const SHARE_SAFE_HIDDEN_ELEMENTS = new Set([
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
  if (element.localName === 'hidden') return true
  const rPr = element.parent
  return !(rPr && isWord(rPr, 'rPr') && rPr.parent && isWord(rPr.parent, 'pPr'))
}

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

export const SHARE_SAFE_SDT_IDENTITY_ELEMENTS = new Set([
  'tag',
  'placeholder',
  'id',
])

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

export const SHARE_SAFE_FONT_EMBED_ELEMENTS = new Set([
  'embedRegular',
  'embedBold',
  'embedItalic',
  'embedBoldItalic',
])

export const SHARE_SAFE_UNWRAP_ELEMENTS = new Set(['smartTag', 'customXml'])

export const SHARE_SAFE_COMMENT_MARKERS = new Set([
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'annotationRef',
])

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
