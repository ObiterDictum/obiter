import {
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN,
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'
import { decodeXmlReferences, findXmlTagEnd } from '@obiter/ooxml'
import type { HighlightValue, VertAlignValue } from './document-format-types'

const RUN_HISTORY_ELEMENTS = new Set(['rPrChange'])
const PARAGRAPH_HISTORY_ELEMENTS = new Set(['rPrChange', 'pPrChange'])

export function withoutTrackedRunProperties(xml: string): string {
  return withoutTrackedHistory(xml, RUN_HISTORY_ELEMENTS)
}

export function withoutTrackedParagraphProperties(xml: string): string {
  return withoutTrackedHistory(xml, PARAGRAPH_HISTORY_ELEMENTS)
}

type ScannedTag = {
  qualifiedName: string
  localName: string
  close: boolean
  selfClosing: boolean
}

function withoutTrackedHistory(
  xml: string,
  names: ReadonlySet<string>,
): string {
  let result = ''
  let kept = 0
  let scan = 0
  for (;;) {
    const opening = xml.indexOf('<', scan)
    if (opening === -1) return result + xml.slice(kept)
    const end = tagEnd(xml, opening)
    if (end === undefined) return result + xml.slice(kept)
    const tag = scanTag(xml, opening, end)
    if (!tag || tag.close || !names.has(tag.localName)) {
      scan = end
      continue
    }
    result += xml.slice(kept, opening)
    kept = scan = tag.selfClosing
      ? end
      : changeElementEnd(xml, end, tag.qualifiedName)
  }
}

function changeElementEnd(
  xml: string,
  openEnd: number,
  qualifiedName: string,
): number {
  let depth = 1
  let cursor = openEnd
  for (;;) {
    const opening = xml.indexOf('<', cursor)
    if (opening === -1) return xml.length
    const end = tagEnd(xml, opening)
    if (end === undefined) return xml.length
    const tag = scanTag(xml, opening, end)
    if (tag?.qualifiedName === qualifiedName) {
      if (tag.close) {
        depth -= 1
        if (depth === 0) return end
      } else if (!tag.selfClosing) {
        depth += 1
      }
    }
    cursor = end
  }
}

function tagEnd(xml: string, index: number): number | undefined {
  if (xml.startsWith('<!--', index)) return markerEnd(xml, '-->', index + 4)
  if (xml.startsWith('<![CDATA[', index))
    return markerEnd(xml, ']]>', index + 9)
  if (xml.startsWith('<?', index)) return markerEnd(xml, '?>', index + 2)
  try {
    return findXmlTagEnd(xml, index + 1)
  } catch {
    return undefined
  }
}

function markerEnd(xml: string, marker: string, from: number) {
  const index = xml.indexOf(marker, from)
  return index === -1 ? undefined : index + marker.length
}

function scanTag(
  xml: string,
  opening: number,
  end: number,
): ScannedTag | undefined {
  const body = xml.slice(opening + 1, end - 1)
  if (body.startsWith('!') || body.startsWith('?')) return undefined
  const close = body.startsWith('/')
  const name = /^[^\s/>]+/u.exec(close ? body.slice(1) : body)?.[0]
  if (!name) return undefined
  return {
    qualifiedName: name,
    localName: name.slice(name.indexOf(':') + 1),
    close,
    selfClosing: !close && /\/\s*$/u.test(body),
  }
}

function xmlPrefix(xml: string): string {
  return xml.match(/<([A-Za-z_][\w.-]*):/u)?.[1] ?? 'w'
}

function wordAttr(attrs: string | undefined, name: string, prefix: string) {
  return attrs?.match(
    new RegExp(`(?:^|\\s)(?:${prefix}:)?${name}="([^"]+)"`, 'i'),
  )?.[1]
}

function tagAttrs(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  const open = new RegExp(`<${prefix}:${localName}(?=[\\s/>])`, 'i').exec(xml)
  if (!open) return undefined
  const end = tagEnd(xml, open.index)
  return end === undefined
    ? undefined
    : xml.slice(open.index + open[0].length, end - 1)
}

function lowercaseValue(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  return wordAttr(
    tagAttrs(xml, prefix, localName),
    'val',
    prefix,
  )?.toLowerCase()
}

function optionOf<T extends string>(
  options: readonly T[],
  value: string | undefined,
): T | null {
  if (!value) return null
  const lower = value.toLowerCase()
  return options.find((option) => option.toLowerCase() === lower) ?? null
}

export function runFlag(xml: string, localName: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, localName) === undefined) return null
  const value = lowercaseValue(current, prefix, localName)
  return value !== '0' && value !== 'false' && value !== 'off'
}

export function runUnderline(xml: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, 'u') === undefined) return null
  const value = lowercaseValue(current, prefix, 'u')
  return value !== 'none' && value !== '0' && value !== 'false'
}

export function runHighlight(xml: string): HighlightValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditHighlightSchema.options,
    lowercaseValue(current, prefix, 'highlight'),
  )
}

export function runVertAlign(xml: string): VertAlignValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditVertAlignSchema.options,
    lowercaseValue(current, prefix, 'vertAlign'),
  )
}

export function runFontFamily(xml: string): string | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  const fonts = tagAttrs(current, prefix, 'rFonts')
  const raw =
    wordAttr(fonts, 'ascii', prefix) ?? wordAttr(fonts, 'hAnsi', prefix)
  if (raw === undefined) return null
  const decoded = decodeAttributeReferences(raw)
  return decoded !== null &&
    decoded.length <= DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH
    ? decoded
    : null
}

export function runFontSize(xml: string): number | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  const value = wordAttr(tagAttrs(current, prefix, 'sz'), 'val', prefix)
  if (value === undefined) return null
  const size = Number(value)
  return Number.isInteger(size) &&
    size >= DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN &&
    size <= DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX
    ? size
    : null
}

function decodeAttributeReferences(value: string): string | null {
  try {
    return decodeXmlReferences(value)
  } catch {
    return null
  }
}

export function runColour(xml: string): string | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  const value = wordAttr(tagAttrs(current, prefix, 'color'), 'val', prefix)
  if (!value) return null
  if (value.toLowerCase() === 'auto') return 'auto'
  return /^[0-9A-Fa-f]{6}$/u.test(value) ? value.toUpperCase() : null
}
