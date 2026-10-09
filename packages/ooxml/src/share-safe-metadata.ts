import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  DOC_PROPS_VT_NAMESPACE,
  MARKING_PROPERTY_TYPES,
} from './parts/custom-properties'
import {
  adoptOrphanedCustomPropertiesPart,
  markingPropertyXml,
} from './parts/custom-properties-write'
import { setOverlayReplacement } from './parts/overlay'
import { attributeValue, type XmlElement } from './parts/xml-elements'
import {
  CANONICAL_APP_PROPERTIES_XML,
  CANONICAL_CORE_PROPERTIES_XML,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'
import { decodeXmlReferences } from './xml-lexemes'

export const SHARE_SAFE_CANONICAL_EMITS = {
  'scrub-core-properties': CANONICAL_CORE_PROPERTIES_XML,
  'scrub-app-properties': CANONICAL_APP_PROPERTIES_XML,
} as const

/** Replaces the part's whole payload with its canonical emission. */
export function emitCanonicalPart(part: SourcePart, xml: string) {
  const overlay = part.overlay
  if (!overlay)
    refuseShareSafe('malformed-package', `${part.name} has no parse surface`)
  setOverlayReplacement(overlay, 'share-safe:canonical', {
    start: 0,
    end: overlay.source.length,
    value: xml,
  })
  part.dirty = true
}

/**
 * Rewrites the custom-properties part from scratch: only validated product
 * markings survive, serialised canonically so no foreign attribute, comment
 * or processing instruction rides inside an allowed name. Unknown `obiter.*`
 * names are not this build's markings and are dropped with the rest.
 */
export function rewriteCustomProperties(
  document: OoxmlDocument,
  part: SourcePart,
  elements: readonly XmlElement[],
  orphaned: boolean,
) {
  const overlay = part.overlay
  if (!overlay)
    refuseShareSafe('malformed-package', `${part.name} has no parse surface`)
  const root = elements.find((element) => element.depth === 0)
  if (
    !root ||
    root.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE ||
    root.localName !== 'Properties'
  ) {
    refuseShareSafe('malformed-package', 'custom properties part is malformed')
  }
  const seen = new Set<string>()
  const kept: string[] = []
  let pid = 2
  for (const element of elements) {
    if (
      element.parent !== root ||
      element.namespaceUri !== CUSTOM_PROPERTIES_NAMESPACE ||
      element.localName !== 'property'
    ) {
      continue
    }
    const name = attributeValue(element, '', 'name')
    if (name === undefined || !(name in MARKING_PROPERTY_TYPES)) continue
    if (seen.has(name)) {
      refuseShareSafe(
        'malformed-package',
        `duplicated marking property ${name}`,
      )
    }
    seen.add(name)
    // SAFETY: the `in` check above admits only the four marking names.
    const type =
      MARKING_PROPERTY_TYPES[name as keyof typeof MARKING_PROPERTY_TYPES]
    const values = elements.filter(
      (candidate) =>
        candidate.parent === element &&
        candidate.namespaceUri === DOC_PROPS_VT_NAMESPACE,
    )
    if (values.length !== 1) {
      refuseShareSafe(
        'malformed-package',
        `marking property ${name} is malformed`,
      )
    }
    const value = values[0]!
    const text = decodeXmlReferences(
      overlay.source.slice(value.startTagEnd, value.endTagStart),
    ).trim()
    if (type === 'string') {
      if (
        value.localName !== 'lpwstr' &&
        value.localName !== 'lpstr' &&
        value.localName !== 'bstr'
      ) {
        refuseShareSafe(
          'opaque-payload',
          `marking property ${name} has a foreign value type`,
        )
      }
      if (text === '') continue
      kept.push(markingPropertyXml(pid++, name, text))
      continue
    }
    if (value.localName !== 'bool') {
      refuseShareSafe(
        'opaque-payload',
        `marking property ${name} has a foreign value type`,
      )
    }
    const flag = text.toLowerCase()
    if (flag !== 'true' && flag !== 'false' && flag !== '1' && flag !== '0') {
      refuseShareSafe(
        'malformed-package',
        `marking property ${name} is not a readable flag`,
      )
    }
    kept.push(markingPropertyXml(pid++, name, flag === 'true' || flag === '1'))
  }

  // An orphaned custom.xml adopted for its markings needs the declaration a
  // referenced part carries; a file that never parses as Properties was
  // already refused above.
  if (orphaned) {
    try {
      adoptOrphanedCustomPropertiesPart(document)
    } catch (cause) {
      if (cause instanceof OoxmlError) {
        refuseShareSafe(
          'malformed-package',
          'orphaned custom properties could not be declared',
        )
      }
      throw cause
    }
  }
  setOverlayReplacement(overlay, 'share-safe:rewrite', {
    start: 0,
    end: overlay.source.length,
    value:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Properties xmlns="${CUSTOM_PROPERTIES_NAMESPACE}" xmlns:vt="${DOC_PROPS_VT_NAMESPACE}">` +
      kept.join('') +
      `</Properties>`,
  })
  part.dirty = true
}
