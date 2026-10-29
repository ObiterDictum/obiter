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

export type ShareSafeElementVerdict = 'keep' | 'remove' | 'unwrap' | 'refuse'

export function shareSafeElementVerdict(
  element: XmlElement,
  family: ShareSafePartFamily,
  dispositionKind: ShareSafePartDisposition['kind'],
): ShareSafeElementVerdict {
  if (element.namespaceUri === MARKUP_COMPAT_NAMESPACE) {
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
    return 'strip'
  }
  if (EMBEDDED_ELEMENTS.has(element.namespaceUri)) {
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
  return 'strip'
}
