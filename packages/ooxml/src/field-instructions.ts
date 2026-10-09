import { decodeXmlReferences } from './xml-lexemes'

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

const FIELD_OR_INSTRUCTION =
  /<w:fldChar\b[^>]*\bw:fldCharType="(begin|end|separate)"[^>]*\/?>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:fldSimple\b[^>]*?\bw:instr="([\s\S]*?)"/gu

/**
 * Every stored field instruction carried by an XML string — one entry per
 * field, with a complex field's `instrText` runs merged and a
 * `w:fldSimple`'s decoded `w:instr` standing alone. The scan pairs
 * `fldChar` begins and ends so two `TA` fields in one window never merge
 * into each other's switches; a field that never closes still emits what
 * its instruction accumulated.
 */
export function fieldInstructionsInXml(xml: string) {
  const instructions: string[] = []
  const buffers: string[] = []
  const separated: boolean[] = []
  for (const match of xml.matchAll(FIELD_OR_INSTRUCTION)) {
    const instrText = match[2]
    if (instrText !== undefined) {
      const depth = buffers.length - 1
      if (depth >= 0 && !separated[depth]) {
        buffers[depth] += decodeXmlReferences(instrText)
      }
      continue
    }
    const simpleInstr = match[3]
    if (simpleInstr !== undefined) {
      instructions.push(decodeXmlReferences(simpleInstr))
      continue
    }
    const type = match[1]
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
    const buffer = buffers.pop() ?? ''
    separated.pop()
    instructions.push(buffer)
  }
  while (buffers.length > 0) {
    instructions.push(buffers.pop() ?? '')
    separated.pop()
  }
  return instructions
}
