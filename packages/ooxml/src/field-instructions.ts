import { parseStartTag } from './parts/overlay'
import {
  attributeValue,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { decodeXmlReferences, findXmlTagEnd, xmlInnerText } from './xml-lexemes'

/**
 * A stored field instruction parsed the way Word reads it: a field name,
 * plain arguments, and `\` switches each carrying their own arguments.
 * Matching is semantic, not substring — an instruction split across
 * `instrText` runs, carried in a `w:fldSimple` `w:instr` attribute, or
 * written with different whitespace reads identically once the caller has
 * decoded XML entities and concatenated the fragments.
 */
const INSTRUCTION_TOKEN = /\\[A-Za-z*]+|"(?:[^"\\]|\\.)*"|«[^»]*»|\S+/gu

/** The instruction's lexical tokens: `\h`, `"1"`, `PAGEREF`, `_Ref1`. */
export function fieldInstructionTokens(instruction: string) {
  const tokens: string[] = []
  for (const match of instruction.matchAll(INSTRUCTION_TOKEN)) {
    tokens.push(match[0])
  }
  return tokens
}

/** The field's name — `TOA`, `PAGEREF` — or `''` when the instruction
 * leads with a switch or quotes rather than a name. */
export function fieldInstructionName(instruction: string) {
  const first = fieldInstructionTokens(instruction)[0]
  if (
    first === undefined ||
    first.startsWith('\\') ||
    first.startsWith('"') ||
    first.startsWith('«')
  ) {
    return ''
  }
  return first.toUpperCase()
}

/**
 * The token's operand value with Word's `"…"`/`«…»` quoting removed —
 * `fieldInstructionTokens` output carries the raw token spelling.
 */
export function fieldInstructionTokenValue(token: string) {
  return tokenArgument(token)
}

function tokenArgument(token: string) {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith('«') && token.endsWith('»'))
  ) {
    return token.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return token
}

/**
 * The arguments each occurrence of `switchName` carries — `fieldSwitchArguments(
 * ' TOA \\h \\c "1" ', 'c')` returns `['1']`. An argument is every token
 * between the switch and the next switch or the instruction's end, with
 * Word's `"…"` / `«…»` quoting removed.
 */
export function fieldSwitchArguments(instruction: string, switchName: string) {
  const tokens = fieldInstructionTokens(instruction)
  const args: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (
      !token.startsWith('\\') ||
      token.slice(1).toLowerCase() !== switchName.toLowerCase()
    ) {
      continue
    }
    for (
      let j = i + 1;
      j < tokens.length && !tokens[j].startsWith('\\');
      j += 1
    ) {
      args.push(tokenArgument(tokens[j]))
    }
  }
  return args
}

/** `fieldInstructionName` of `TOA`. */
export function isTableOfAuthoritiesField(instruction: string) {
  return fieldInstructionName(instruction) === 'TOA'
}

/**
 * Whether a `TA` instruction marks `citation` — the `\l` long-form argument
 * is the marked text, so a field hiding the citation elsewhere in its
 * switches does not count as marking it.
 */
export function tableAuthorityMarkMatches(
  instruction: string,
  citation: string,
) {
  return (
    fieldInstructionName(instruction) === 'TA' &&
    fieldSwitchArguments(instruction, 'l').some(
      (argument) => argument === citation,
    )
  )
}

/**
 * Skips a comment, CDATA section or processing instruction — constructs that
 * cannot carry field markup — and returns the cursor past them, or `-1`
 * when the input is not such a construct.
 */
function skipXmlConstruct(xml: string, opening: number) {
  if (xml.startsWith('<!--', opening)) {
    const close = xml.indexOf('-->', opening + 4)
    return close === -1 ? xml.length : close + 3
  }
  if (xml.startsWith('<![CDATA[', opening)) {
    const close = xml.indexOf(']]>', opening + 9)
    return close === -1 ? xml.length : close + 3
  }
  if (xml.startsWith('<?', opening)) {
    const close = xml.indexOf('?>', opening + 2)
    return close === -1 ? xml.length : close + 2
  }
  return -1
}

/** The position of `</w:instrText` that closes an open `instrText` run. */
function instrTextClose(xml: string, start: number) {
  let cursor = start
  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor)
    if (opening === -1) return -1
    const skipped = skipXmlConstruct(xml, opening)
    if (skipped !== -1) {
      cursor = skipped
      continue
    }
    if (xml.startsWith('</w:instrText', opening)) return opening
    let tagEnd: number
    try {
      tagEnd = findXmlTagEnd(xml, opening + 1)
    } catch {
      return -1
    }
    cursor = tagEnd
  }
  return -1
}

/**
 * Every stored field instruction carried by an XML string — one entry per
 * field, with a complex field's `instrText` runs merged and a
 * `w:fldSimple`'s decoded `w:instr` standing alone. The scan walks markup
 * constructs rather than matching tag text, so a comment or CDATA inside an
 * `instrText` resolves the way an XML parser reads it instead of corrupting
 * the instruction. It pairs `fldChar` begins and ends so two `TA` fields in
 * one window never merge into each other's switches; a field that never
 * closes still emits what its instruction accumulated.
 */
export function fieldInstructionsInXml(xml: string) {
  const instructions: string[] = []
  const buffers: string[] = []
  const separated: boolean[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor)
    if (opening === -1) break
    const skipped = skipXmlConstruct(xml, opening)
    if (skipped !== -1) {
      cursor = skipped
      continue
    }
    let tagEnd: number
    try {
      tagEnd = findXmlTagEnd(xml, opening + 1)
    } catch {
      break
    }
    if (xml.startsWith('</', opening) || xml.startsWith('<!', opening)) {
      cursor = tagEnd
      continue
    }
    let tag
    try {
      tag = parseStartTag(xml.slice(opening + 1, tagEnd - 1))
    } catch {
      cursor = tagEnd
      continue
    }
    cursor = tagEnd
    if (tag.qualifiedName === 'w:instrText') {
      if (tag.selfClosing) continue
      const close = instrTextClose(xml, tagEnd)
      if (close === -1) break
      const depth = buffers.length - 1
      if (depth >= 0 && !separated[depth]) {
        buffers[depth] += xmlInnerText(xml, tagEnd, close)
      }
      try {
        cursor = findXmlTagEnd(xml, close + 2)
      } catch {
        break
      }
      continue
    }
    if (tag.qualifiedName === 'w:fldSimple') {
      const instruction = tag.attributes.find(
        (attribute) => attribute.qualifiedName === 'w:instr',
      )
      if (instruction !== undefined) {
        instructions.push(decodeXmlReferences(instruction.value))
      }
      continue
    }
    if (tag.qualifiedName !== 'w:fldChar') continue
    const type = tag.attributes.find(
      (attribute) => attribute.qualifiedName === 'w:fldCharType',
    )?.value
    if (type === 'begin') {
      buffers.push('')
      separated.push(false)
      continue
    }
    if (buffers.length === 0) continue
    if (type === 'separate') {
      separated[separated.length - 1] = true
      continue
    }
    if (type === 'end') {
      instructions.push(buffers.pop() ?? '')
      separated.pop()
    }
  }
  while (buffers.length > 0) {
    instructions.push(buffers.pop() ?? '')
    separated.pop()
  }
  return instructions
}

/**
 * The namespace-aware variant of `fieldInstructionsInXml` for callers that
 * already hold a parsed element list: field constructs are matched on their
 * expanded names, so an `instrText` bound to the WordprocessingML namespace
 * under a different prefix — or a `w:` prefix bound elsewhere — reads
 * exactly as Word resolves it, not as the literal `w:` spelling suggests.
 * `source` backs the element offsets, so `instrText` bodies come from the
 * same document the elements were parsed from.
 */
export function fieldInstructionsFromElements(
  source: string,
  elements: readonly XmlElement[],
) {
  const instructions: string[] = []
  const buffers: string[] = []
  const separated: boolean[] = []
  for (const element of elements) {
    if (element.namespaceUri !== WORD_NAMESPACE) continue
    if (element.localName === 'instrText') {
      const depth = buffers.length - 1
      if (depth >= 0 && !separated[depth]) {
        buffers[depth] += xmlInnerText(
          source,
          element.startTagEnd,
          element.endTagStart,
        )
      }
      continue
    }
    if (element.localName === 'fldSimple') {
      const instruction = attributeValue(element, WORD_NAMESPACE, 'instr')
      if (instruction !== undefined) instructions.push(instruction)
      continue
    }
    if (element.localName !== 'fldChar') continue
    const type = attributeValue(element, WORD_NAMESPACE, 'fldCharType')
    if (type === 'begin') {
      buffers.push('')
      separated.push(false)
      continue
    }
    if (buffers.length === 0) continue
    if (type === 'separate') {
      separated[separated.length - 1] = true
      continue
    }
    if (type === 'end') {
      instructions.push(buffers.pop() ?? '')
      separated.pop()
    }
  }
  while (buffers.length > 0) {
    instructions.push(buffers.pop() ?? '')
    separated.pop()
  }
  return instructions
}
