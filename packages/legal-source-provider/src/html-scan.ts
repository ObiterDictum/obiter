function isWordChar(char: string | undefined) {
  return char !== undefined && /[A-Za-z0-9_]/u.test(char)
}

function findIgnoringCase(text: string, literal: string, from: number) {
  const pattern = new RegExp(
    literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
    'gi',
  )
  pattern.lastIndex = from
  return pattern.exec(text)?.index ?? -1
}

export function replaceTags(value: string, replacement: string) {
  let output = ''
  let cursor = 0
  let index = value.indexOf('<')
  while (index !== -1) {
    const end = value.indexOf('>', index + 1)
    if (end === -1) break
    if (end > index + 1) {
      output += value.slice(cursor, index) + replacement
      cursor = end + 1
      index = value.indexOf('<', cursor)
    } else {
      index = value.indexOf('<', index + 1)
    }
  }
  return output + value.slice(cursor)
}

export function replaceElements(
  html: string,
  name: string,
  replacement: string,
) {
  const open = `<${name}`
  const close = `</${name}`
  let output = ''
  let cursor = 0
  let searchFrom = 0
  while (searchFrom < html.length) {
    const start = findIgnoringCase(html, open, searchFrom)
    if (start === -1) break
    if (isWordChar(html[start + open.length])) {
      searchFrom = start + 1
      continue
    }
    let closeAt = findIgnoringCase(html, close, start + open.length)
    while (closeAt !== -1 && isWordChar(html[closeAt + close.length])) {
      closeAt = findIgnoringCase(html, close, closeAt + 1)
    }
    if (closeAt === -1) break
    const end = html.indexOf('>', closeAt + close.length)
    if (end === -1) break
    output += html.slice(cursor, start) + replacement
    cursor = end + 1
    searchFrom = cursor
  }
  return output + html.slice(cursor)
}

export function unwrapCdata(value: string) {
  const open = '<![CDATA['
  let output = ''
  let cursor = 0
  let start = value.indexOf(open)
  while (start !== -1) {
    const end = value.indexOf(']]>', start + open.length)
    if (end === -1) break
    output += value.slice(cursor, start) + value.slice(start + open.length, end)
    cursor = end + 3
    start = value.indexOf(open, cursor)
  }
  return output + value.slice(cursor)
}

export function readElementContent(
  xml: string,
  name: string,
  matchesAttributes: (attributes: string) => boolean,
) {
  const open = `<${name}`
  const close = `</${name}>`
  let searchFrom = 0
  while (searchFrom < xml.length) {
    const start = findIgnoringCase(xml, open, searchFrom)
    if (start === -1) return undefined
    searchFrom = start + 1
    if (isWordChar(xml[start + open.length])) continue
    const tagEnd = xml.indexOf('>', start + open.length)
    if (tagEnd === -1) return undefined
    if (!matchesAttributes(xml.slice(start + open.length, tagEnd))) continue
    const closeAt = findIgnoringCase(xml, close, tagEnd + 1)
    if (closeAt === -1) return undefined
    return xml.slice(tagEnd + 1, closeAt)
  }
  return undefined
}

export function collapseSpaceRuns(value: string) {
  return value.replace(/ {2,}/gu, ' ')
}
