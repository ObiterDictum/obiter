import { RELATIONSHIPS_NAMESPACE } from './structure-xml'
import {
  attributeValue,
  WORD_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
} from './parts/xml-elements'
import {
  CONTENT_TYPE_ATTRIBUTES,
  CONTENT_TYPES_NAMESPACE,
  isAllowedElementNamespace,
  isContentTypeElement,
  isRelationshipPartElement,
  isWordExtensionNamespace,
  MARKUP_COMPAT_NAMESPACE,
  PACKAGE_REL_NAMESPACE,
  RELATIONSHIP_ATTRIBUTES,
  XML_NAMESPACE_URI,
  type ShareSafePartDisposition,
  type ShareSafePartFamily,
} from './share-safe-parts'
import {
  COMPAT_SETTING_NAMES,
  COMPAT_SETTING_URI,
  SHARE_SAFE_CARRIER_ELEMENTS,
  SHARE_SAFE_MARKER_ELEMENTS,
  WML_ELEMENTS,
} from './share-safe-word-vocabulary'
import { WML_ATTRIBUTES } from './share-safe-word-attributes'
import {
  hiddenElementRefuses,
  isSdtScoped,
  REVISION_IDENTITY_ATTRIBUTES,
  SHARE_SAFE_COMMENT_MARKERS,
  SHARE_SAFE_OPAQUE_ELEMENTS,
  SHARE_SAFE_REVISION_ELEMENTS,
  SHARE_SAFE_SDT_IDENTITY_ELEMENTS,
  SHARE_SAFE_SDT_POINTER_ELEMENTS,
  SHARE_SAFE_SETTINGS_REMOVE,
  SHARE_SAFE_UNWRAP_ELEMENTS,
  SHARE_SAFE_WEB_POINTER_ELEMENTS,
} from './share-safe-word-classes'
import {
  EMBEDDED_ATTRIBUTES,
  EMBEDDED_STRIP_ATTRIBUTES,
  EMBEDDED_NAME_LABEL_ELEMENTS,
  EXTENSION_URI_PATTERN,
  GRAPHIC_DATA_URIS,
} from './share-safe-drawing-attributes'
import { EMBEDDED_ELEMENTS } from './share-safe-drawing-vocabulary'

/**
 * The element-level half of the share-safe policy: what may exist inside a
 * kept part once its root and part family are proven. Element names that
 * carry revision markup, hidden content, opaque payloads or external
 * pointers refuse; metadata elements are removed or unwrapped; every other
 * element name must appear on the bounded allow-list for its namespace.
 * Attributes resolve per element context. Scan, transform and verifier all
 * run on this one vocabulary — the classification sets themselves live in
 * `share-safe-word-classes`, the name allow-lists in the vocabulary files.
 */

const ON_VALUES = new Set(['1', 'true', 'on'])

export type ShareSafeElementVerdict = 'keep' | 'remove' | 'unwrap' | 'refuse'

/**
 * What the policy does with an element, given the part's family and
 * disposition. `'remove'` and `'unwrap'` are transforms — the verifier
 * treats either surviving in the output as residue. A `w:` element missing
 * from the allow-list, and any element in a namespace the per-namespace
 * allow-lists do not cover, refuses rather than shipping unclassified
 * markup.
 */
export function shareSafeElementVerdict(
  element: XmlElement,
  family: ShareSafePartFamily,
  dispositionKind: ShareSafePartDisposition['kind'],
): ShareSafeElementVerdict {
  if (element.namespaceUri === MARKUP_COMPAT_NAMESPACE) {
    // AlternateContent / Choice / Fallback are resolved by the content
    // analysis — the surviving branch's elements get real verdicts; the
    // wrappers themselves never emit. Any other mc: element is unknown.
    return /^(?:AlternateContent|Choice|Fallback)$/u.test(element.localName)
      ? 'keep'
      : 'refuse'
  }
  if (!isAllowedElementNamespace(element.namespaceUri, family)) {
    return 'refuse'
  }
  if (element.namespaceUri === PACKAGE_REL_NAMESPACE) {
    return isRelationshipPartElement(element.localName) ? 'keep' : 'refuse'
  }
  if (element.namespaceUri === CONTENT_TYPES_NAMESPACE) {
    return isContentTypeElement(element.localName) ? 'keep' : 'refuse'
  }
  if (element.namespaceUri !== WORD_NAMESPACE) {
    // Word-extension elements inside settings are product state (docId and
    // friends); the transform removes them whole.
    if (
      dispositionKind === 'scrub-settings' &&
      isWordExtensionNamespace(element.namespaceUri)
    ) {
      return 'remove'
    }
    const allowed = EMBEDDED_ELEMENTS.get(element.namespaceUri)
    return allowed !== undefined && allowed.has(element.localName)
      ? 'keep'
      : 'refuse'
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
    SHARE_SAFE_CARRIER_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_MARKER_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_COMMENT_MARKERS.has(element.localName)
  ) {
    return 'remove'
  }
  if (
    dispositionKind === 'scrub-settings' &&
    SHARE_SAFE_SETTINGS_REMOVE.has(element.localName)
  ) {
    return 'remove'
  }
  // compatSetting names and URIs are a bounded vendor vocabulary — a
  // foreign one is a label carrier, not a compat instruction. Outside
  // settings the name has no legitimate placement and falls to the
  // allow-list miss.
  if (
    element.localName === 'compatSetting' &&
    dispositionKind === 'scrub-settings'
  ) {
    const uri = attributeValue(element, WORD_NAMESPACE, 'uri')
    const name = attributeValue(element, WORD_NAMESPACE, 'name')
    return uri === COMPAT_SETTING_URI &&
      name !== undefined &&
      COMPAT_SETTING_NAMES.has(name)
      ? 'keep'
      : 'remove'
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
  return WML_ELEMENTS.has(element.localName) ? 'keep' : 'refuse'
}

export type ShareSafeAttributeVerdict =
  | 'keep'
  | 'strip'
  | 'relationship-pointer'
  | 'refuse'
  | 'refuse-hidden'
  | 'refuse-revision'

const XML_ATTRIBUTES_KEPT = new Set(['space', 'lang'])

/**
 * What the policy does with an attribute. Revision identity
 * (`author`/`date`/`ed`/`edGrp` on the `w:` or Word extension namespaces)
 * refuses wherever it appears — those names exist only on revision markup.
 * Relationship-namespace attributes resolve against the part's declared
 * relationships by the caller. `w:` elements carry only the allow-list of
 * `w:` attributes (everything else strips) and an unqualified attribute on
 * a `w:` element refuses outright — Word never writes one. Embedded
 * elements carry the bounded unqualified name list with descriptive
 * carriers (`descr`/`title`/`name` labels, `hidden`, `uri`) resolved
 * element-scoped.
 */
export function shareSafeAttributeVerdict(
  element: XmlElement,
  attribute: XmlAttribute,
): ShareSafeAttributeVerdict {
  if (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE) {
    return 'relationship-pointer'
  }
  if (
    REVISION_IDENTITY_ATTRIBUTES.has(attribute.localName) &&
    (attribute.namespaceUri === WORD_NAMESPACE ||
      isWordExtensionNamespace(attribute.namespaceUri))
  ) {
    return 'refuse-revision'
  }
  if (element.namespaceUri === PACKAGE_REL_NAMESPACE) {
    return element.localName === 'Relationship' &&
      attribute.namespaceUri === '' &&
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
    return 'strip'
  }
  if (element.namespaceUri === WORD_NAMESPACE) {
    if (attribute.namespaceUri === '') return 'refuse'
    if (attribute.namespaceUri === WORD_NAMESPACE) {
      if (attribute.localName.toLowerCase().startsWith('rsid')) {
        return 'strip'
      }
      if (attribute.localName === 'displacedByCustomXml') return 'strip'
      return WML_ATTRIBUTES.has(attribute.localName) ? 'keep' : 'strip'
    }
    if (attribute.namespaceUri === XML_NAMESPACE_URI) {
      return XML_ATTRIBUTES_KEPT.has(attribute.localName) ? 'keep' : 'strip'
    }
    // Word-extension, markup-compatibility and foreign attributes are
    // non-semantic metadata here — dropped, never emitted.
    return 'strip'
  }
  if (EMBEDDED_ELEMENTS.has(element.namespaceUri)) {
    if (attribute.namespaceUri === '') {
      if (EMBEDDED_STRIP_ATTRIBUTES.has(attribute.localName)) return 'strip'
      if (attribute.localName === 'hidden') {
        return ON_VALUES.has(attribute.value.trim().toLowerCase())
          ? 'refuse-hidden'
          : 'strip'
      }
      if (
        attribute.localName === 'name' &&
        EMBEDDED_NAME_LABEL_ELEMENTS.has(element.localName)
      ) {
        return 'strip'
      }
      if (attribute.localName === 'uri') {
        if (element.localName === 'graphicData') {
          return GRAPHIC_DATA_URIS.has(attribute.value) ? 'keep' : 'refuse'
        }
        return EXTENSION_URI_PATTERN.test(attribute.value) ? 'keep' : 'strip'
      }
      return EMBEDDED_ATTRIBUTES.has(attribute.localName) ? 'keep' : 'strip'
    }
    if (attribute.namespaceUri === XML_NAMESPACE_URI) {
      return XML_ATTRIBUTES_KEPT.has(attribute.localName) ? 'keep' : 'strip'
    }
    return 'strip'
  }
  // mc: elements never emit; metadata parts discard their input.
  return 'strip'
}

/** `wp:docPr`/`a:cNvPr` — kept for the verifier's descriptive checks. */
export const DOCUMENT_OBJECT_PROPS_ELEMENTS = new Set(['docPr', 'cNvPr'])
