export type ProcessingInstruction = { target: string; data: string }

export function inspectXmlLexemes(xml: string) {
  const instructions: ProcessingInstruction[] = []
  let cursor = 0

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
    } else {
      cursor = opening + 1
    }
  }

  return instructions
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
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
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
