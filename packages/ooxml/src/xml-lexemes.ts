export type ProcessingInstruction = { target: string; data: string }

export function inspectXmlLexemes(xml: string) {
  const instructions: ProcessingInstruction[] = []
  let cursor = 0
  let depth = 0
  let rootEnd: number | undefined

  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor)
    if (opening === -1) break

    if (xml.startsWith('<!--', opening)) {
      cursor = findClosing(xml, '-->', opening + 4)
    } else if (xml.startsWith('<![CDATA[', opening)) {
      cursor = findClosing(xml, ']]>', opening + 9)
    } else if (xml.startsWith('<!DOCTYPE', opening)) {
      const end = findDoctypeEnd(xml, opening + '<!DOCTYPE'.length)
      const declaration = xml.slice(opening, end)
      if (hasUnsupportedDtd(declaration)) {
        throw new Error('External DTDs and entity declarations are unsupported')
      }
      cursor = end
    } else if (xml.startsWith('<?', opening)) {
      const end = findClosing(xml, '?>', opening + 2)
      const body = xml.slice(opening + 2, end - 2)
      const separator = findXmlWhitespace(body)
      const target = separator === -1 ? body : body.slice(0, separator)
      if (!target) throw new Error('Processing instruction has no target')
      if (target !== 'xml') {
        instructions.push({
          target,
          data:
            separator === -1
              ? ''
              : trimXmlWhitespaceStart(body.slice(separator)),
        })
      }
      cursor = end
    } else if (xml.startsWith('<!', opening)) {
      throw new Error('Unsupported XML declaration')
    } else {
      const tagEnd = findXmlTagEnd(xml, opening + 1)
      if (xml.startsWith('</', opening)) {
        depth -= 1
        if (depth === 0 && rootEnd === undefined) rootEnd = tagEnd
      } else if (isSelfClosingTag(xml, tagEnd)) {
        if (depth === 0 && rootEnd === undefined) rootEnd = tagEnd
      } else {
        depth += 1
      }
      cursor = tagEnd
    }
  }

  return {
    instructions,
    hasOnlyWhitespaceAfterRoot:
      rootEnd !== undefined && hasOnlyXmlWhitespace(xml, rootEnd),
  }
}

export function decodeXmlReferences(value: string) {
  const reference = /&(?:#(\d+)|#x([\da-fA-F]+)|(amp|apos|gt|lt|quot));/gy
  let cursor = 0
  let decoded = ''

  while (cursor < value.length) {
    const ampersand = value.indexOf('&', cursor)
    if (ampersand === -1) return decoded + value.slice(cursor)

    decoded += value.slice(cursor, ampersand)
    reference.lastIndex = ampersand
    const match = reference.exec(value)
    if (!match) throw new Error('Unsupported or malformed entity reference')

    const [, decimal, hexadecimal, named] = match
    if (decimal) decoded += decodeCodePoint(Number.parseInt(decimal, 10))
    else if (hexadecimal)
      decoded += decodeCodePoint(Number.parseInt(hexadecimal, 16))
    else decoded += decodeNamedReference(named)
    cursor = reference.lastIndex
  }

  return decoded
}

function hasUnsupportedDtd(declaration: string) {
  const withoutComments = declaration.replace(/<!--[\s\S]*?-->/gu, '')
  const header = withoutComments.slice('<!DOCTYPE'.length).split('[', 1)[0]
  const hasExternalIdentifier = /^\s*[^\s>[\]]+\s+(?:SYSTEM|PUBLIC)\b/u.test(
    header,
  )
  return hasExternalIdentifier || /<!ENTITY\b/u.test(withoutComments)
}

function findXmlWhitespace(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (isXmlWhitespace(value[index])) return index
  }
  return -1
}

function trimXmlWhitespaceStart(value: string) {
  const firstContent = findXmlContent(value)
  return firstContent === -1 ? '' : value.slice(firstContent)
}

function findXmlContent(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (!isXmlWhitespace(value[index])) return index
  }
  return -1
}

function isXmlWhitespace(value: string) {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r'
}

function hasOnlyXmlWhitespace(value: string, start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (!isXmlWhitespace(value[index])) return false
  }
  return true
}

export function findXmlTagEnd(xml: string, start: number) {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  throw new Error('Unclosed XML tag')
}

function isSelfClosingTag(xml: string, tagEnd: number) {
  let cursor = tagEnd - 2
  while (cursor >= 0 && isXmlWhitespace(xml[cursor])) cursor -= 1
  return xml[cursor] === '/'
}

function findClosing(xml: string, marker: string, start: number) {
  const index = xml.indexOf(marker, start)
  if (index === -1) throw new Error('Unclosed XML construct')
  return index + marker.length
}

function findDoctypeEnd(xml: string, start: number) {
  let quote = ''
  let subsetDepth = 0

  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '[') {
      subsetDepth += 1
    } else if (character === ']') {
      subsetDepth -= 1
    } else if (character === '>' && subsetDepth === 0) {
      return index + 1
    }
  }

  throw new Error('Unclosed DOCTYPE')
}

function decodeCodePoint(codePoint: number) {
  const isXmlCharacter =
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  if (!Number.isInteger(codePoint) || !isXmlCharacter) {
    throw new Error('Invalid character reference')
  }
  return String.fromCodePoint(codePoint)
}

function decodeNamedReference(name: string | undefined) {
  if (name === 'amp') return '&'
  if (name === 'apos') return "'"
  if (name === 'gt') return '>'
  if (name === 'lt') return '<'
  if (name === 'quot') return '"'
  throw new Error('Unsupported entity reference')
}
