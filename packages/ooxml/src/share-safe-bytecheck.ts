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
import { mathAttributeVerdict } from './share-safe-math-attributes'
import {
  embeddedAttributeVerdict,
  XML_SPACE_VALUES,
} from './share-safe-drawing-attributes'
import { EMBEDDED_ELEMENTS } from './share-safe-drawing-vocabulary'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * The byte-level half of verification: independent of the element parser,
 * the emitted source is walked lexeme by lexeme and must show the shape
 * canonical emission promised — the standard declaration, no comments,
 * processing instructions, CDATA wrappers or DOCTYPEs, only namespace
 * declarations spelling canonical prefixes for allow-listed URIs, and no
 * prefixed attribute carrying revision identity.
 *
 * This layer deliberately re-derives structure from the emitted bytes
 * rather than trusting the element list — a writer that byte-spliced
 * anything the parser never modelled is caught here, not by DOM replay.
 */

const XML_DECLARATION =
  /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>[\r\n]*/u

/** Every namespace URI a byte-level declaration may name. */
const SAFE_NAMESPACE_URIS = new Set([
  ...CANONICAL_NAMESPACE_PREFIXES.keys(),
  CORE_PROPERTIES_NAMESPACE,
  EXTENDED_PROPERTIES_NAMESPACE,
  CUSTOM_PROPERTIES_NAMESPACE,
  DOC_PROPS_VT_NAMESPACE,
])

/** The prefix a declared URI must spell — canonical or metadata emit. */
const EXPECTED_PREFIXES = new Map<string, string>([
  ...CANONICAL_NAMESPACE_PREFIXES,
  [CORE_PROPERTIES_NAMESPACE, 'cp'],
  [EXTENDED_PROPERTIES_NAMESPACE, ''],
  [CUSTOM_PROPERTIES_NAMESPACE, ''],
  [DOC_PROPS_VT_NAMESPACE, 'vt'],
])

/** Prefixed attribute local names that identify revision markup. */
const REVISION_IDENTITY_LOCALS = new Set(['author', 'date', 'ed', 'edGrp'])

const BOOKMARK_NAME = /^bm\d+$/u

export interface ByteCheckResult {
  bookmarkNames: string[]
  anchorTargets: string[]
  /** Reference-field operands (`REF`/`PAGEREF`/`NOTEREF`/`GOTOBUTTON`). */
  fieldReferences: string[]
}

/**
 * Asserts the lexical postconditions on one emitted XML part and returns
 * the bookmark names and anchor targets it declares for the package-level
 * cross-check (`w:anchor` must name a bookmark that shipped).
 */
export function checkShareSafeXmlBytes(
  part: SourcePart,
  source: string,
): ByteCheckResult {
  const declaration = XML_DECLARATION.exec(source)
  if (!declaration) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} is missing the canonical XML declaration`,
    )
  }
  const declaredPrefixes = new Map<string, string>()
  const bookmarkNames: string[] = []
  const anchorTargets: string[] = []
  const fieldReferences: string[] = []
  // `Id` values this part's `Relationship` declarations have used — a
  // duplicate makes `r:id` resolution ambiguous.
  const relationshipIds = new Set<string>()

  let cursor = declaration[0].length
  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor)
    if (opening === -1) break
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

    // Attribute scan inside the tag body — bounded to the tag's extent,
    // never free text. Namespace declarations resolve first so the tag
    // name and every attribute check against this element's decls.
    const inner = body.slice(tagName.length)
    const attributes = [
      ...inner.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/gu),
    ]
    for (const match of attributes) {
      const name = match[1]!
      if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue
      const value = match[2]!.slice(1, -1)
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
    for (const match of attributes) {
      const name = match[1]!
      const value = match[2]!.slice(1, -1)
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue
      const colon = name.indexOf(':')
      if (colon !== -1) {
        checkPrefixedName(part, name, declaredPrefixes)
        const prefix = name.slice(0, colon)
        const local = name.slice(colon + 1)
        if (prefix === 'xml') {
          // `xml:space` is the only `xml:` attribute that may emit, and
          // only with one of its two switch values.
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
        // A `w:` attribute must sit on the `w:` element that declares it
        // — `w:instr`/`w:name`/`w:anchor`/`w:uri`/`w:id` out of scope are
        // payload channels, not formatting. Relationship pointers are
        // proven against the package graph by the package-level check;
        // `mc:` attributes are only ever the `Ignorable` declaration,
        // which is checked below. Every other embedded namespace declares
        // no prefixed attributes at all, so one reaching the emitted bytes
        // is a writer splice.
        if (prefix === 'w') {
          const wmlLocal = tagName.startsWith('w:') ? tagName.slice(2) : ''
          const allowed = WML_ELEMENT_ATTRIBUTES.get(wmlLocal)
          if (allowed === undefined || !allowed.has(local)) {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} out of element scope`,
            )
          }
          // The emitted value must satisfy the same bound the transform
          // applied — a writer that spliced an out-of-enumeration value
          // into a declared slot is caught here.
          if (wmlAttributeVerdict(wmlLocal, local, value) !== 'keep') {
            refuseShareSafe(
              'unverifiable-output',
              `${part.name} carries ${name} outside its bound`,
            )
          }
        } else if (prefix === 'm') {
          // OMML `m:val` resolves through the same per-element bound the
          // transform applied; any other `m:` attribute refuses.
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
        // An unqualified attribute on a `w:` element is a payload channel
        // Word never writes; on an embedded element it must satisfy the
        // same bounded vocabulary the transform applied.
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
      if (tagName === 'Relationship' && name === 'Id') {
        if (relationshipIds.has(value)) {
          refuseShareSafe(
            'unverifiable-output',
            `${part.name} declares relationship ${value} twice`,
          )
        }
        relationshipIds.add(value)
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
    cursor = tagEnd
  }

  // Field instructions surviving in emitted bytes must all be keep-class;
  // a reference field's operands are collected so the package-level check
  // can prove each names a bookmark that shipped.
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

/** A qualified name's prefix must resolve to a declared canonical URI. */
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
