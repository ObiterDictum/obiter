import type {
  DocumentModelWire,
  DocumentNumberingLevelWire,
  DocumentParagraphWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { twipToPx, xmlAttr, xmlTagAttrs } from './document-page-units'

export type ListMarker = {
  text: string
  leftPx: number
  hangingPx: number
}

const DEFAULT_LEFT_TWIPS = 720
const DEFAULT_HANGING_TWIPS = 360

export function documentListMarkers(
  model: DocumentModelWire,
): Map<string, ListMarker> {
  const markers = new Map<string, ListMarker>()
  const story = documentStory(model)
  if (!story) return markers
  const counters = new Map<string, number[]>()
  for (const paragraph of story.paragraphs) {
    const marker = paragraphListMarker(paragraph, model, counters)
    if (marker) markers.set(paragraph.id, marker)
  }
  return markers
}

export function paragraphListIndent(
  paragraph: DocumentParagraphWire,
  model: Pick<DocumentModelWire, 'numbering' | 'styles'>,
): Pick<ListMarker, 'leftPx' | 'hangingPx'> | undefined {
  const numPr = paragraphNumPr(paragraph, model.styles)
  if (!numPr) return undefined
  const instance = model.numbering.find(
    (item) => item.numberingId === numPr.numId,
  )
  const level = instance?.levels?.find((item) => item.ilvl === numPr.ilvl)
  if (!level) return undefined
  return {
    leftPx: twipToPx(level.indentLeftTwips ?? DEFAULT_LEFT_TWIPS),
    hangingPx: twipToPx(level.hangingTwips ?? DEFAULT_HANGING_TWIPS),
  }
}

export function paragraphListMarker(
  paragraph: DocumentParagraphWire,
  model: Pick<DocumentModelWire, 'numbering' | 'styles'>,
  counters: Map<string, number[]>,
): ListMarker | undefined {
  const numPr = paragraphNumPr(paragraph, model.styles)
  if (!numPr) return undefined
  const instance = model.numbering.find(
    (item) => item.numberingId === numPr.numId,
  )
  const level = instance?.levels?.find((item) => item.ilvl === numPr.ilvl)
  if (!instance || !level) return undefined
  const values = nextCounters(
    counters,
    instance.numberingId,
    numPr.ilvl,
    level,
    instance.startOverride,
  )
  const leftTwips = level.indentLeftTwips ?? DEFAULT_LEFT_TWIPS
  const hangingTwips = level.hangingTwips ?? DEFAULT_HANGING_TWIPS
  return {
    text: formatMarker(level, values, instance.levels ?? []),
    leftPx: twipToPx(leftTwips),
    hangingPx: twipToPx(hangingTwips),
  }
}

export function paragraphNumPr(
  paragraph: DocumentParagraphWire,
  styles: DocumentStyleWire[],
): { numId: string; ilvl: number } | undefined {
  const fromParagraph = numPrFromXml(paragraph.preservedXmlFragments.join(''))
  if (fromParagraph) return fromParagraph
  return numPrFromXml(styleXml(styles, paragraph.styleId))
}

function numPrFromXml(
  xml: string,
): { numId: string; ilvl: number } | undefined {
  const block = xml.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/i)?.[0]
  if (!block) return undefined
  const numId = xmlAttr(xmlTagAttrs(block, 'numId'), 'val')
  if (!numId || numId === '0') return undefined
  const ilvl = Number(xmlAttr(xmlTagAttrs(block, 'ilvl'), 'val') ?? '0')
  if (!Number.isInteger(ilvl) || ilvl < 0 || ilvl > 8) return undefined
  return { numId, ilvl }
}

function styleXml(styles: DocumentStyleWire[], styleId: string | undefined) {
  const seen = new Set<string>()
  const parts: string[] = []
  let current = styleId
  while (current && !seen.has(current)) {
    seen.add(current)
    const style = styles.find((item) => item.styleId === current)
    if (!style) break
    parts.push(style.sourceFragment)
    current = style.basedOnStyleId
  }
  return parts.join('')
}

function nextCounters(
  counters: Map<string, number[]>,
  numberingId: string,
  ilvl: number,
  level: DocumentNumberingLevelWire,
  startOverride: number | undefined,
): number[] {
  const values = [...(counters.get(numberingId) ?? [])]
  while (values.length <= ilvl) values.push(0)
  const start =
    ilvl === 0 && startOverride !== undefined
      ? startOverride
      : (level.start ?? 1)
  values[ilvl] = (values[ilvl] || start - 1) + 1
  values.length = ilvl + 1
  counters.set(numberingId, values)
  return values
}

function formatMarker(
  level: DocumentNumberingLevelWire,
  values: number[],
  levels: DocumentNumberingLevelWire[],
): string {
  const template = level.lvlText
  if (template && /%\d/.test(template)) {
    return template.replace(/%(\d)/g, (_match, digit: string) => {
      const index = Number(digit) - 1
      const value = values[index]
      if (value === undefined) return ''
      const format =
        levels.find((item) => item.ilvl === index)?.numFmt ?? 'decimal'
      return formatValue(value, format)
    })
  }
  const value = values[level.ilvl] ?? 1
  if (level.numFmt === 'bullet') return '•'
  const formatted = formatValue(value, level.numFmt)
  if (level.numFmt === 'none') return ''
  return `${formatted}.`
}

function formatValue(value: number, numFmt: string): string {
  if (numFmt === 'bullet' || numFmt === 'none') return ''
  if (numFmt === 'lowerLetter') return letters(value)
  if (numFmt === 'upperLetter') return letters(value).toUpperCase()
  if (numFmt === 'lowerRoman') return roman(value)
  if (numFmt === 'upperRoman') return roman(value).toUpperCase()
  if (numFmt === 'decimalZero') return String(value).padStart(2, '0')
  return String(value)
}

function letters(value: number): string {
  let remaining = value
  let result = ''
  while (remaining > 0) {
    remaining -= 1
    result = String.fromCharCode(97 + (remaining % 26)) + result
    remaining = Math.floor(remaining / 26)
  }
  return result
}

function roman(value: number): string {
  const glyphs: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let remaining = value
  let result = ''
  for (const [amount, glyph] of glyphs) {
    while (remaining >= amount) {
      result += glyph
      remaining -= amount
    }
  }
  return result
}
