import {
  CUSTOM_PROPERTIES_NAMESPACE,
  DOC_PROPS_VT_NAMESPACE,
} from './parts/custom-properties'
import {
  WORD_NAMESPACE,
  type ExpandedName,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'

export { DOC_PROPS_VT_NAMESPACE }

/**
 * The package-level half of the share-safe policy: which parts may ship,
 * the root each must carry, and the namespaces each part family allows.
 * The inventory uses the relationship table to place parts; the scan uses
 * the family rules to bound what may exist inside them.
 */

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

/**
 * The prefix every emitted part spells for a kept namespace. Emission
 * declares only namespaces the kept elements and attributes actually use,
 * so an unused `xmlns:` declaration — a byte channel that hides foreign
 * URIs in source XML — can never reach the output.
 */
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

/**
 * Namespaces older readers know how to skip only when named in
 * `mc:Ignorable`. Emitted parts declare the attribute themselves — a
 * generated, bounded value — when their kept elements draw on one.
 */
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

/** The `.rels` part that declares relationships owned by `sourcePartName`. */
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
  /** The root element the part must parse to, proven by its relationship. */
  root?: ExpandedName
  /** An orphaned `docProps/custom.xml` adopted by name, not relationship. */
  orphaned?: boolean
}

/**
 * The inventory's verdict for one package: a disposition for every part and
 * the relationship declarations the transform strips because their target
 * was dropped or the pointer is detachable (an external hyperlink is
 * unlinked, an attached template detached — neither ships its target).
 */
export type ShareSafePlan = {
  dispositions: Map<string, ShareSafePartDisposition>
  /** relationships part name → relationship ids to remove from it */
  stripRelationships: Map<string, Set<string>>
  /** owning part name → detached relationship ids and their shapes */
  detachedReferences: Map<string, Map<string, DetachedReferenceShape>>
  /**
   * Per kept XML part, the content decisions the emitter applies: elements
   * removed or unwrapped, field instructions rewritten. Computed once at
   * plan time so scan and transform can never disagree.
   */
  contentPlans: Map<string, ShareSafeContentPlan>
  /** Binary parts rewritten in place (stripped image metadata). */
  binaryPayloads: Map<string, Uint8Array>
  /** Bookmark names replaced by generated `bm<n>` values. */
  bookmarkRenames: Map<string, string>
  /**
   * The canonical name every kept non-declaration part emits under —
   * original part names are identifier text and never ship.
   */
  partRenames: Map<string, string>
  /**
   * Relationships part name → original `Id` → generated `rId<n>` the
   * canonical declaration emits. Owner-part references rewrite through it.
   */
  relationshipIds: Map<string, Map<string, string>>
}

/**
 * What a part's emission stage needs to know — computed while the plan
 * scans the parsed surface. `removed` elements never emit, `unwrapped`
 * elements emit their children but no tags, `textOverrides` replace an
 * element's content, and `attrOverrides` rewrite (`string`) or drop
 * (`undefined`) an attribute.
 */
export type ShareSafeContentPlan = {
  /** The parsed element tree the emitter and verifier walk. */
  elements: XmlElement[]
  removed: Set<XmlElement>
  unwrapped: Set<XmlElement>
  textOverrides: Map<XmlElement, string>
  attrOverrides: Map<XmlAttribute, string | undefined>
}

export type DetachedReferenceShape =
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

/**
 * Relationship types the copy keeps and the root each target must carry —
 * a `header` relationship pointing at `<w:document>` is ambiguous and
 * refuses rather than shipping under a guessed role.
 */
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

/**
 * Relationships whose targets the copy removes outright — comment surfaces
 * (every recognised namespace vintage), the `people` part, thumbnail
 * previews and digital signatures, which are void once sanitised.
 */
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
  // Effects-only style sheets, customXml datastores (Word writes a
  // bibliography store into nearly every document it saves) and the
  // building-block glossary are dead payload in a share-safe copy: nothing
  // inside them ships, and the markup that bound to them is stripped at
  // element level.
  'stylesWithEffects',
  'customXml',
  'customXmlProps',
  'glossaryDocument',
  // Embedded font payloads are font-program bytes the binary layer cannot
  // bound or re-serialise metadata-free — the part drops with its
  // relationship, and the `w:embed*` elements pointing at it are removed
  // at element level.
  'font',
])

/**
 * The family a kept XML part belongs to, proven by its root namespace —
 * which element namespaces are legal inside it follows from the family,
 * not from the elements' prefixes.
 */
export type ShareSafePartFamily =
  'word' | 'theme' | 'relationships' | 'content-types' | 'metadata'

export function shareSafePartFamily(
  rootNamespace: string,
): ShareSafePartFamily {
  if (rootNamespace === WORD_NAMESPACE) return 'word'
  if (rootNamespace === DRAWINGML_MAIN_NAMESPACE) return 'theme'
  if (rootNamespace === PACKAGE_REL_NAMESPACE) return 'relationships'
  if (rootNamespace === CONTENT_TYPES_NAMESPACE) return 'content-types'
  // Core, app and custom properties are rewritten canonically — the input
  // surface below the root never ships, so it needs no family rules.
  return 'metadata'
}

export function isWordExtensionNamespace(namespaceUri: string) {
  return namespaceUri.startsWith(WORD_EXTENSION_PREFIX)
}

export function isEmbeddedNamespace(namespaceUri: string) {
  return (
    namespaceUri.startsWith(DRAWINGML_PREFIX) ||
    namespaceUri.startsWith(DRAWING_EXTENSION_PREFIX) ||
    namespaceUri.startsWith(THEME_EXTENSION_PREFIX) ||
    namespaceUri === MATH_NAMESPACE
  )
}

/**
 * Element namespaces a part family may carry. A word-family part allows
 * WordprocessingML, markup compatibility, DrawingML and its extension
 * vintages, Word's own extension vocabularies, and OMML. VML and Office
 * (`urn:schemas-microsoft-com:vml`, `…:office:office`, `…:office:word`),
 * smart-tag urns, the `dt:`/`sl:` metadata namespaces and every strict
 * OOXML namespace are absent — an element the policy cannot place refuses
 * the export rather than shipping.
 */
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

/** Relationship parts carry only `Relationships` root + `Relationship`. */
export function isRelationshipPartElement(localName: string) {
  return localName === 'Relationships' || localName === 'Relationship'
}

/** Content-type parts carry only `Types`, `Default`, `Override`. */
export function isContentTypeElement(localName: string) {
  return (
    localName === 'Types' || localName === 'Default' || localName === 'Override'
  )
}

/** The only attributes a `Relationship` element may carry. */
export const RELATIONSHIP_ATTRIBUTES = new Set([
  'Id',
  'Type',
  'Target',
  'TargetMode',
])

/** The only attributes content-type entries may carry. */
export const CONTENT_TYPE_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
  ['Types', new Set()],
  ['Default', new Set(['Extension', 'ContentType'])],
  ['Override', new Set(['PartName', 'ContentType'])],
])

/** The canonical payload the core/app property parts emit. */
export const CANONICAL_CORE_PROPERTIES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `\r\n<cp:coreProperties xmlns:cp="${CORE_PROPERTIES_NAMESPACE}"></cp:coreProperties>`
export const CANONICAL_APP_PROPERTIES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `\r\n<Properties xmlns="${EXTENDED_PROPERTIES_NAMESPACE}"></Properties>`
