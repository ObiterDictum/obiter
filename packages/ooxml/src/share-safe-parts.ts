import { CUSTOM_PROPERTIES_NAMESPACE } from './parts/custom-properties'
import {
  WORD_NAMESPACE,
  type ExpandedName,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'

export const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'
export const PACKAGE_REL_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
export const CORE_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
export const EXTENDED_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
export const MARKUP_COMPAT_NAMESPACE =
  'http://schemas.openxmlformats.org/markup-compatibility/2006'
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace'
export const MATH_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/math'
export const DRAWINGML_MAIN_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/main'

const OFFICE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const PACKAGE_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships/'
const DRAWINGML_PREFIX = 'http://schemas.openxmlformats.org/drawingml/2006/'
const WORD_EXTENSION_PREFIX = 'http://schemas.microsoft.com/office/word/'
const DRAWING_EXTENSION_PREFIX = 'http://schemas.microsoft.com/office/drawing/'
const THEME_EXTENSION_PREFIX = 'http://schemas.microsoft.com/office/thememl/'

export const DRAWINGML_PICTURE_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/picture'
export const WP_DRAWING_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
export const WPS_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
export const WP14_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
export const WPG_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
export const WPC_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas'
export const DRAWINGML_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/drawing/2010/main'

export const CANONICAL_NAMESPACE_PREFIXES = new Map<string, string>([
  [WORD_NAMESPACE, 'w'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  [MATH_NAMESPACE, 'm'],
  [DRAWINGML_MAIN_NAMESPACE, 'a'],
  [DRAWINGML_PICTURE_NAMESPACE, 'pic'],
  [WP_DRAWING_NAMESPACE, 'wp'],
  [WPS_NAMESPACE, 'wps'],
  [WPG_NAMESPACE, 'wpg'],
  [WPC_NAMESPACE, 'wpc'],
  [WP14_NAMESPACE, 'wp14'],
  [DRAWINGML_2010_NAMESPACE, 'a14'],
  [MARKUP_COMPAT_NAMESPACE, 'mc'],
  [PACKAGE_REL_NAMESPACE, ''],
  [CONTENT_TYPES_NAMESPACE, ''],
  [XML_NAMESPACE_URI, 'xml'],
])

export const IGNORABLE_NAMESPACES = new Set([
  WPS_NAMESPACE,
  WPG_NAMESPACE,
  WPC_NAMESPACE,
  WP14_NAMESPACE,
  DRAWINGML_2010_NAMESPACE,
])

export const PACKAGE_OWNER = ''
export const PACKAGE_RELATIONSHIPS_PART = '_rels/.rels'
export const CONTENT_TYPES_PART = '[Content_Types].xml'

export function relationshipsPartFor(sourcePartName: string) {
  if (sourcePartName === PACKAGE_OWNER) return PACKAGE_RELATIONSHIPS_PART
  const slash = sourcePartName.lastIndexOf('/')
  const directory = slash === -1 ? '' : sourcePartName.slice(0, slash + 1)
  const name = slash === -1 ? sourcePartName : sourcePartName.slice(slash + 1)
  return `${directory}_rels/${name}.rels`
}

export type ShareSafePartDisposition = {
  kind:
    | 'keep'
    | 'drop'
    | 'scrub-core-properties'
    | 'scrub-app-properties'
    | 'scrub-settings'
    | 'custom-properties'
  root?: ExpandedName
  orphaned?: boolean
}

export type ShareSafePlan = {
  dispositions: Map<string, ShareSafePartDisposition>
  stripRelationships: Map<string, Set<string>>
  detachedReferences: Map<string, Map<string, DetachedReferenceShape>>
  contentPlans: Map<string, ShareSafeContentPlan>
  binaryPayloads: Map<string, Uint8Array>
  bookmarkRenames: Map<string, string>
  partRenames: Map<string, string>
  relationshipIds: Map<string, Map<string, string>>
}

export type ShareSafeContentPlan = {
  elements: XmlElement[]
  removed: Set<XmlElement>
  unwrapped: Set<XmlElement>
  textOverrides: Map<XmlElement, string>
  attrOverrides: Map<XmlAttribute, string | undefined>
}

type DetachedReferenceShape =
  'hyperlink' | 'attachedTemplate' | 'printerSettings'

const w = (localName: string): ExpandedName => ({
  namespaceUri: WORD_NAMESPACE,
  localName,
})

export type ShareSafeKeepSpec = {
  kind: ShareSafePartDisposition['kind']
  root?: ExpandedName
  binary: boolean
  unique: boolean
}

const keep = (localName: string, unique = false): ShareSafeKeepSpec => ({
  kind: 'keep',
  root: w(localName),
  binary: false,
  unique,
})

export const KEEP_RELATIONSHIPS = new Map<string, ShareSafeKeepSpec>([
  [`${OFFICE_REL}officeDocument`, keep('document', true)],
  [`${OFFICE_REL}styles`, keep('styles', true)],
  [`${OFFICE_REL}numbering`, keep('numbering', true)],
  [`${OFFICE_REL}fontTable`, keep('fonts', true)],
  [`${OFFICE_REL}webSettings`, keep('webSettings', true)],
  [
    `${OFFICE_REL}theme`,
    {
      kind: 'keep',
      root: {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE,
        localName: 'theme',
      },
      binary: false,
      unique: true,
    },
  ],
  [`${OFFICE_REL}header`, keep('hdr')],
  [`${OFFICE_REL}footer`, keep('ftr')],
  [`${OFFICE_REL}footnotes`, keep('footnotes')],
  [`${OFFICE_REL}endnotes`, keep('endnotes')],
  [`${OFFICE_REL}image`, { kind: 'keep', binary: true, unique: false }],
  [
    `${OFFICE_REL}settings`,
    {
      kind: 'scrub-settings',
      root: w('settings'),
      binary: false,
      unique: true,
    },
  ],
  [
    `${PACKAGE_REL}metadata/core-properties`,
    {
      kind: 'scrub-core-properties',
      root: {
        namespaceUri: CORE_PROPERTIES_NAMESPACE,
        localName: 'coreProperties',
      },
      binary: false,
      unique: true,
    },
  ],
  [
    `${OFFICE_REL}extended-properties`,
    {
      kind: 'scrub-app-properties',
      root: {
        namespaceUri: EXTENDED_PROPERTIES_NAMESPACE,
        localName: 'Properties',
      },
      binary: false,
      unique: true,
    },
  ],
  [
    `${OFFICE_REL}custom-properties`,
    {
      kind: 'custom-properties',
      root: {
        namespaceUri: CUSTOM_PROPERTIES_NAMESPACE,
        localName: 'Properties',
      },
      binary: false,
      unique: true,
    },
  ],
])

export const DROP_RELATIONSHIP_TAILS = new Set([
  'comments',
  'commentsExtended',
  'commentsIds',
  'commentsExtensible',
  'commentsAuthors',
  'people',
  'thumbnail',
  'signature',
  'origin',
  'certificate',
  'stylesWithEffects',
  'customXml',
  'customXmlProps',
  'glossaryDocument',
  'font',
])

export type ShareSafePartFamily =
  'word' | 'theme' | 'relationships' | 'content-types' | 'metadata'

export function shareSafePartFamily(
  rootNamespace: string,
): ShareSafePartFamily {
  if (rootNamespace === WORD_NAMESPACE) return 'word'
  if (rootNamespace === DRAWINGML_MAIN_NAMESPACE) return 'theme'
  if (rootNamespace === PACKAGE_REL_NAMESPACE) return 'relationships'
  if (rootNamespace === CONTENT_TYPES_NAMESPACE) return 'content-types'
  return 'metadata'
}

export function isWordExtensionNamespace(namespaceUri: string) {
  return namespaceUri.startsWith(WORD_EXTENSION_PREFIX)
}

function isEmbeddedNamespace(namespaceUri: string) {
  return (
    namespaceUri.startsWith(DRAWINGML_PREFIX) ||
    namespaceUri.startsWith(DRAWING_EXTENSION_PREFIX) ||
    namespaceUri.startsWith(THEME_EXTENSION_PREFIX) ||
    namespaceUri === MATH_NAMESPACE
  )
}

export function isAllowedElementNamespace(
  namespaceUri: string,
  family: ShareSafePartFamily,
) {
  switch (family) {
    case 'word':
      return (
        namespaceUri === WORD_NAMESPACE ||
        namespaceUri === MARKUP_COMPAT_NAMESPACE ||
        isWordExtensionNamespace(namespaceUri) ||
        isEmbeddedNamespace(namespaceUri)
      )
    case 'theme':
      return (
        namespaceUri === MARKUP_COMPAT_NAMESPACE ||
        isEmbeddedNamespace(namespaceUri)
      )
    case 'relationships':
      return namespaceUri === PACKAGE_REL_NAMESPACE
    case 'content-types':
      return namespaceUri === CONTENT_TYPES_NAMESPACE
    case 'metadata':
      return true
  }
}

export function isRelationshipPartElement(localName: string) {
  return localName === 'Relationships' || localName === 'Relationship'
}

export function isContentTypeElement(localName: string) {
  return (
    localName === 'Types' || localName === 'Default' || localName === 'Override'
  )
}

export const RELATIONSHIP_ATTRIBUTES = new Set([
  'Id',
  'Type',
  'Target',
  'TargetMode',
])

export const CONTENT_TYPE_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
  ['Types', new Set()],
  ['Default', new Set(['Extension', 'ContentType'])],
  ['Override', new Set(['PartName', 'ContentType'])],
])

export const CANONICAL_CORE_PROPERTIES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `\r\n<cp:coreProperties xmlns:cp="${CORE_PROPERTIES_NAMESPACE}"></cp:coreProperties>`
export const CANONICAL_APP_PROPERTIES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `\r\n<Properties xmlns="${EXTENDED_PROPERTIES_NAMESPACE}"></Properties>`
