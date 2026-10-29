import { parseStartTag } from './parts/overlay'
import { decodeXmlReferences, findXmlTagEnd, xmlInnerText } from './xml-lexemes'

const INSTRUCTION_TOKEN = /\\[A-Za-z*]+|"(?:[^"\\]|\\.)*"|«[^»]*»|\S+/gu

export function fieldInstructionTokens(instruction: string) {
  const tokens: string[] = []
  for (const match of instruction.matchAll(INSTRUCTION_TOKEN)) {
    tokens.push(match[0])
  }
  return tokens
}

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

export function isTableOfAuthoritiesField(instruction: string) {
  return fieldInstructionName(instruction) === 'TOA'
}

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
