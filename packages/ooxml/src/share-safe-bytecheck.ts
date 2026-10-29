import type { SourcePart } from './model'
import { WORD_NAMESPACE } from './parts/xml-elements'
import {
  CUSTOM_PROPERTIES_NAMESPACE,
  DOC_PROPS_VT_NAMESPACE,
} from './parts/custom-properties'
import { findXmlTagEnd } from './xml-lexemes'
import {
  fieldInstructionName,
  fieldInstructionsInXml,
  fieldInstructionTokens,
  fieldInstructionTokenValue,
} from './field-instructions'
import {
  CANONICAL_NAMESPACE_PREFIXES,
  CORE_PROPERTIES_NAMESPACE,
  EXTENDED_PROPERTIES_NAMESPACE,
} from './share-safe-parts'
import {
  FIELD_REFERENCE_NAMES,
  isFormulaFieldInstruction,
  SHARE_SAFE_FIELD_NAMES,
} from './share-safe-fields'
import {
  WML_ELEMENT_ATTRIBUTES,
  wmlAttributeVerdict,
} from './share-safe-word-attributes'
import {
  mathAttributeVerdict,
  mathElementMissingRequiredAttribute,
} from './share-safe-math-attributes'
import {
  embeddedAttributeVerdict,
  EMBEDDED_REQUIRED_ATTRIBUTES,
  XML_SPACE_VALUES,
} from './share-safe-drawing-attributes'
import {
  EMBEDDED_ELEMENTS,
  embeddedElementRefusesHidden,
} from './share-safe-drawing-vocabulary'
import {
  checkDeclarationTagBytes,
  checkEmittedPartName,
  isDeclarationPartName,
} from './share-safe-bytecheck-declarations'
import { DRAWINGML_MAIN_NAMESPACE, MATH_NAMESPACE } from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

const XML_DECLARATION =
  /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>[\r\n]*/u

const SAFE_NAMESPACE_URIS = new Set([
  ...CANONICAL_NAMESPACE_PREFIXES.keys(),
  CORE_PROPERTIES_NAMESPACE,
  EXTENDED_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_NAMESPACE,
  DOC_PROPS_VT_NAMESPACE,
])

const EXPECTED_PREFIXES = new Map<string, string>([
  ...CANONICAL_NAMESPACE_PREFIXES,
  [CORE_PROPERTIES_NAMESPACE, 'cp'],
  [EXTENDED_PROPERTIES_NAMESPACE, ''],
  [CUSTOM_PROPERTIES_NAMESPACE, ''],
  [DOC_PROPS_VT_NAMESPACE, 'vt'],
])

const REVISION_IDENTITY_LOCALS = new Set(['author', 'date', 'ed', 'edGrp'])

const BOOKMARK_NAME = /^bm\d+$/u

export interface ByteCheckResult {
  bookmarkNames: string[]
  anchorTargets: string[]
  fieldReferences: string[]
}

export function checkShareSafeXmlBytes(
  part: SourcePart,
  source: string,
): ByteCheckResult {
  checkEmittedPartName(part)
  const declaration = XML_DECLARATION.exec(source)
  if (!declaration) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} is missing the canonical XML declaration`,
    )
  }
  const declarationsOnly = isDeclarationPartName(part.name)
  const declaredPrefixes = new Map<string, string>()
  const bookmarkNames: string[] = []
  const anchorTargets: string[] = []
  const fieldReferences: string[] = []
  const relationshipSequence = { next: 1 }

  let cursor = declaration[0].length
  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor)
    if (opening === -1) break
    if (declarationsOnly && !/^\s*$/u.test(source.slice(cursor, opening))) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} carries text between declarations`,
      )
    }
    if (
      source.startsWith('<!--', opening) ||
      source.startsWith('<![CDATA[', opening) ||
      source.startsWith('<?', opening) ||
      source.startsWith('<!', opening)
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} carries a lexical construct canonical emission forbids`,
      )
    }
    let tagEnd: number
    try {
      tagEnd = findXmlTagEnd(source, opening + 1)
    } catch {
      refuseShareSafe('unverifiable-output', `${part.name} holds a broken tag`)
    }
    const closing = source.startsWith('</', opening)
    const body = source.slice(opening + (closing ? 2 : 1), tagEnd - 1)
    const tagName = /^[^\s/>]+/u.exec(body)?.[0]
    if (!tagName) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} holds a malformed tag`,
      )
    }
    if (closing) {
      checkPrefixedName(part, tagName, declaredPrefixes)
      cursor = tagEnd
      continue
    }

    const inner = body.slice(tagName.length)
    const attributes = [
      ...inner.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/gu),
    ]
    for (const match of attributes) {
      const name = match[1]
      if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue
      const value = match[2].slice(1, -1)
      const prefix = name === 'xmlns' ? '' : name.slice(6)
      if (!SAFE_NAMESPACE_URIS.has(value)) {
        refuseShareSafe(
          'unverifiable-output',
          `${part.name} declares foreign namespace ${value}`,
        )
      }
      const expected = EXPECTED_PREFIXES.get(value)
      if (expected !== prefix) {
        refuseShareSafe(
          'unverifiable-output',
          `${part.name} declares ${value} under a non-canonical prefix`,
        )
      }
      declaredPrefixes.set(prefix, value)
    }
    checkPrefixedName(part, tagName, declaredPrefixes)
    const elementColon = tagName.indexOf(':')
    const elementPrefix =
      elementColon === -1 ? '' : tagName.slice(0, elementColon)
    const elementLocal =
      elementColon === -1 ? tagName : tagName.slice(elementColon + 1)
    const elementUri = declaredPrefixes.get(elementPrefix)
    const unqualifiedAttributes = new Set<string>()
    const qualifiedAttributes = new Set<string>()
    const unqualifiedValues = new Map<string, string>()
    for (const match of attributes) {
      const name = match[1]
      const value = match[2].slice(1, -1)
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue
      const colon = name.indexOf(':')
      if (colon === -1) {
        unqualifiedAttributes.add(name)
        unqualifiedValues.set(name, value)
      } else qualifiedAttributes.add(name)
      if (colon !== -1) {
        checkPrefixedName(part, name, declaredPrefixes)
        const prefix = name.slice(0, colon)
        const local = name.slice(colon + 1)
        if (prefix === 'xml') {
          if (local !== 'space' || !XML_SPACE_VALUES.has(value)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries unsupported ${name}`,
            )
          }
          continue
        }
        if (
          REVISION_IDENTITY_LOCALS.has(local) ||
          local.toLowerCase().startsWith('rsid')
        ) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} carries identity attribute ${name}`,
          )
        }
        if (prefix === 'w') {
          const wmlLocal = tagName.startsWith('w:') ? tagName.slice(2) : ''
          const allowed = WML_ELEMENT_ATTRIBUTES.get(wmlLocal)
          if (allowed === undefined || !allowed.has(local)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} out of element scope`,
            )
          }
          if (wmlAttributeVerdict(wmlLocal, local, value) !== 'keep') {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} outside its bound`,
            )
          }
        } else if (prefix === 'm') {
          const mmlLocal = tagName.startsWith('m:') ? tagName.slice(2) : ''
          if (mathAttributeVerdict(mmlLocal, local, value) !== 'keep') {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} outside its bound`,
            )
          }
        } else if (prefix === 'mc') {
          if (local !== 'Ignorable') {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries unsupported ${name}`,
            )
          }
        } else if (prefix === 'r') {
          if (!/^rId\d+$/u.test(value)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries non-canonical relationship pointer ${name}`,
            )
          }
          continue
        } else {
          const attributeUri = declaredPrefixes.get(prefix)
          if (
            attributeUri !== undefined &&
            EMBEDDED_ELEMENTS.has(attributeUri)
          ) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries embedded-namespaced attribute ${name}`,
            )
          }
        }
      }
      if (colon === -1) {
        if (elementUri === WORD_NAMESPACE) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} carries unqualified attribute ${name}`,
          )
        }
        if (elementUri !== undefined && EMBEDDED_ELEMENTS.has(elementUri)) {
          if (embeddedAttributeVerdict(elementLocal, name, value) !== 'keep') {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} outside its bound`,
            )
          }
        }
      }
      if (tagName === 'w:bookmarkStart' && name === 'w:name') {
        if (!BOOKMARK_NAME.test(value)) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} carries a non-generated bookmark name`,
          )
        }
        bookmarkNames.push(value)
      }
      if (tagName === 'w:hyperlink' && name === 'w:anchor') {
        anchorTargets.push(value)
      }
      if (name === 'mc:Ignorable') {
        for (const token of value.trim().split(/\s+/u)) {
          if (!declaredPrefixes.has(token)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} names an undeclared prefix in mc:Ignorable`,
            )
          }
        }
      }
    }

    if (
      elementUri !== undefined &&
      EMBEDDED_ELEMENTS.has(elementUri) &&
      embeddedElementRefusesHidden({
        namespaceUri: elementUri,
        localName: elementLocal,
      })
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits hidden-content element ${tagName}`,
      )
    }
    if (elementUri !== undefined && EMBEDDED_ELEMENTS.has(elementUri)) {
      const required = EMBEDDED_REQUIRED_ATTRIBUTES.get(elementLocal)
      if (required !== undefined) {
        for (const name of required) {
          if (!unqualifiedAttributes.has(name)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} emits ${tagName} without required ${name}`,
            )
          }
        }
      }
      if (elementLocal === 'ext' && elementUri === DRAWINGML_MAIN_NAMESPACE) {
        const carriesExtension = unqualifiedAttributes.has('uri')
        const carriesSize =
          unqualifiedAttributes.has('cx') && unqualifiedAttributes.has('cy')
        if (!carriesExtension && !carriesSize) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} emits ${tagName} without required attributes`,
          )
        }
      }
      if (
        elementUri === MATH_NAMESPACE &&
        mathElementMissingRequiredAttribute(elementLocal) &&
        !qualifiedAttributes.has('m:val')
      ) {
        refuseShareSafe(
          'unverifiable-output',
          `${part.name} emits ${tagName} without required m:val`,
        )
      }
    }
    checkDeclarationTagBytes(
      part,
      tagName,
      unqualifiedValues,
      qualifiedAttributes,
      relationshipSequence,
    )
    cursor = tagEnd
  }

  if (declarationsOnly && !/^\s*$/u.test(source.slice(cursor))) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} carries text after its last declaration`,
    )
  }

  for (const instruction of fieldInstructionsInXml(source)) {
    if (isFormulaFieldInstruction(instruction)) continue
    const name = fieldInstructionName(instruction)
    if (!SHARE_SAFE_FIELD_NAMES.has(name)) {
      refuseShareSafe(
        'unverifiable-output',
        `field instruction ${name || '(unnamed)'} survived in ${part.name}`,
      )
    }
    if (FIELD_REFERENCE_NAMES.has(name)) {
      const tokens = fieldInstructionTokens(instruction)
      for (const token of tokens.slice(1)) {
        if (!token.startsWith('\\')) {
          fieldReferences.push(fieldInstructionTokenValue(token))
        }
      }
    }
  }

  return { bookmarkNames, anchorTargets, fieldReferences }
}

function checkPrefixedName(
  part: SourcePart,
  qualifiedName: string,
  declaredPrefixes: ReadonlyMap<string, string>,
) {
  const colon = qualifiedName.indexOf(':')
  if (colon === -1) return
  const prefix = qualifiedName.slice(0, colon)
  if (prefix === 'xml') return
  const declared = declaredPrefixes.get(prefix)
  if (declared === undefined) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} uses undeclared prefix ${prefix}`,
    )
  }
  if (
    CANONICAL_NAMESPACE_PREFIXES.get(declared) !== prefix &&
    EXPECTED_PREFIXES.get(declared) !== prefix
  ) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} uses non-canonical prefix ${prefix}`,
    )
  }
}
