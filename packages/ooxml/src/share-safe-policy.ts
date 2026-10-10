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
  DRAWINGML_MAIN_NAMESPACE,
  isAllowedElementNamespace,
  isContentTypeElement,
  isRelationshipPartElement,
  isWordExtensionNamespace,
  MARKUP_COMPAT_NAMESPACE,
  MATH_NAMESPACE,
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
import {
  WML_ELEMENT_ATTRIBUTES,
  wmlAttributeVerdict,
} from './share-safe-word-attributes'
import {
  hiddenElementRefuses,
  isSdtScoped,
  REVISION_IDENTITY_ATTRIBUTES,
  SHARE_SAFE_COMMENT_MARKERS,
  SHARE_SAFE_OPAQUE_ELEMENTS,
  SHARE_SAFE_REVISION_ELEMENTS,
  SHARE_SAFE_SDT_IDENTITY_ELEMENTS,
  SHARE_SAFE_FONT_EMBED_ELEMENTS,
  SHARE_SAFE_SDT_POINTER_ELEMENTS,
  SHARE_SAFE_SETTINGS_REMOVE,
  SHARE_SAFE_UNWRAP_ELEMENTS,
  SHARE_SAFE_WEB_POINTER_ELEMENTS,
} from './share-safe-word-classes'
import {
  embeddedAttributeVerdict,
  embeddedElementRequiredAttributes,
  XML_SPACE_VALUES,
} from './share-safe-drawing-attributes'
import {
  EMBEDDED_ELEMENTS,
  EMBEDDED_REMOVE_ELEMENTS,
  embeddedElementRefusesHidden,
  SHARE_SAFE_EXTENSION_URIS,
} from './share-safe-drawing-vocabulary'
import {
  mathAttributeVerdict,
  mathElementMissingRequiredAttribute,
} from './share-safe-math-attributes'

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
    if (embeddedElementRefusesHidden(element)) return 'refuse'
    const removed = EMBEDDED_REMOVE_ELEMENTS.get(element.namespaceUri)
    if (removed !== undefined && removed.has(element.localName)) {
      return 'remove'
    }
    // `a:ext` ships only the extensions whose payload vocabulary this
    // build can bound; every other extension — including one named by
    // a text-bearing URI — removes whole rather than refusing the copy.
    if (
      element.namespaceUri === DRAWINGML_MAIN_NAMESPACE &&
      element.localName === 'ext'
    ) {
      return SHARE_SAFE_EXTENSION_URIS.has(
        attributeValue(element, '', 'uri') ?? '',
      )
        ? 'keep'
        : 'remove'
    }
    const allowed = EMBEDDED_ELEMENTS.get(element.namespaceUri)
    if (allowed === undefined || !allowed.has(element.localName)) {
      return 'refuse'
    }
    // An element missing an attribute the schema marks required is
    // malformed or was stripped of the slot that carries its semantics —
    // refuse rather than emit a shape a reader re-interprets.
    if (
      element.namespaceUri === MATH_NAMESPACE &&
      mathElementMissingRequiredAttribute(element.localName) &&
      attributeValue(element, MATH_NAMESPACE, 'val') === undefined
    ) {
      return 'refuse'
    }
    const required = embeddedElementRequiredAttributes(element)
    if (required === 'refuse') return 'refuse'
    if (required !== undefined) {
      for (const name of required) {
        if (attributeValue(element, '', name) === undefined) return 'refuse'
      }
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
    SHARE_SAFE_CARRIER_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_MARKER_ELEMENTS.has(element.localName) ||
    SHARE_SAFE_COMMENT_MARKERS.has(element.localName) ||
    SHARE_SAFE_FONT_EMBED_ELEMENTS.has(element.localName)
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

/**
 * What the policy does with an attribute. Revision identity
 * (`author`/`date`/`ed`/`edGrp` on the `w:` or Word extension namespaces)
 * refuses wherever it appears — those names exist only on revision markup.
 * Relationship-namespace attributes resolve against the part's declared
 * relationships by the caller. `w:` elements carry only the allow-list of
 * `w:` attributes (everything else strips) and an unqualified attribute on
 * a `w:` element refuses outright — Word never writes one. Embedded
 * elements run the shared bounded vocabulary: descriptive carriers
 * (`descr`/`title`/`name` labels, `hidden`) strip or refuse element-scoped,
 * and every other kept name is element-scoped or value-bounded — a bound
 * failure refuses rather than shipping foreign text in a value slot.
 * `xml:space` keeps only its two switch values; `xml:lang` strips.
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
  if (attribute.namespaceUri === XML_NAMESPACE_URI) {
    // `xml:space` is a two-value whitespace switch; `xml:lang` and every
    // other `xml:` attribute carry no layout semantics worth shipping.
    if (attribute.localName === 'space') {
      return XML_SPACE_VALUES.has(attribute.value) ? 'keep' : 'refuse'
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
      // Element-scoped: a `w:` attribute keeps only where the schema
      // declares it — `w:val` or `w:instr` on a `w:p` is a payload
      // channel, not formatting. A declared pair keeps only a value
      // inside its enumeration or lexical bound; anything else is a
      // payload or a malformed document, and the copy refuses rather
      // than silently flipping semantics by stripping it.
      const declared = WML_ELEMENT_ATTRIBUTES.get(element.localName)
      if (declared === undefined || !declared.has(attribute.localName)) {
        return 'strip'
      }
      return wmlAttributeVerdict(
        element.localName,
        attribute.localName,
        attribute.value,
      )
    }
    // Word-extension, markup-compatibility and foreign attributes are
    // non-semantic metadata here — dropped, never emitted.
    return 'strip'
  }
  if (EMBEDDED_ELEMENTS.has(element.namespaceUri)) {
    // Unqualified embedded attributes resolve through the bounded
    // vocabulary: element-scoped names with per-placement value bounds,
    // then the unscoped grammar-bound names. Other embedded namespaces
    // declare no prefixed attributes — except OMML, whose `m:` attribute
    // is `m:val` on property elements with per-element bounds.
    if (attribute.namespaceUri === '') {
      return embeddedAttributeVerdict(
        element.localName,
        attribute.localName,
        attribute.value,
      )
    }
    if (
      element.namespaceUri === MATH_NAMESPACE &&
      attribute.namespaceUri === MATH_NAMESPACE
    ) {
      return mathAttributeVerdict(
        element.localName,
        attribute.localName,
        attribute.value,
      )
    }
    return 'strip'
  }
  // mc: elements never emit; metadata parts discard their input.
  return 'strip'
}

/** `wp:docPr`/`a:cNvPr` — kept for the verifier's descriptive checks. */
export const DOCUMENT_OBJECT_PROPS_ELEMENTS = new Set(['docPr', 'cNvPr'])
