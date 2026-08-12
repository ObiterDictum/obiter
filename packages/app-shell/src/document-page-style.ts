import type { CSSProperties } from 'react'
import type {
  DocumentParagraphWire,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  halfPointToPx,
  twipToPx,
  xmlAttr,
  xmlInner,
  xmlNumber,
  xmlTagAttrs,
} from './document-page-units'

export type RunFace = {
  fontFamily?: string
  fontSizePx?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type ParagraphFace = {
  align?: 'left' | 'center' | 'right' | 'justify'
  marginTopPx: number
  marginBottomPx: number
  lineHeight?: string
  indentLeftPx?: number
  indentRightPx?: number
  indentFirstPx?: number
  run: RunFace
}

const DEFAULT_FONT = 'Calibri, "Segoe UI", "Liberation Sans", sans-serif'
const DEFAULT_SIZE_PX = halfPointToPx(22)
const THEME_FONT: Record<string, string> = {
  minorhansi: 'Calibri',
  minorascii: 'Calibri',
  majorhansi: 'Cambria',
  majorascii: 'Cambria',
}

export function documentDefaultFace(styles: DocumentStyleWire[]): RunFace {
  return paragraphFace(
    { id: 'normal', runs: [], preservedXmlFragments: [], styleId: 'Normal' },
    styles,
  ).run
}

export function paragraphFace(
  paragraph: DocumentParagraphWire,
  styles: DocumentStyleWire[],
): ParagraphFace {
  const chain = styleChain(styles, paragraph.styleId)
  const merged = mergeParagraph(
    ...chain.map((style) => faceFromXml(style.sourceFragment)),
    faceFromXml(paragraph.preservedXmlFragments.join('')),
  )
  return {
    ...merged,
    marginTopPx: merged.marginTopPx,
    marginBottomPx: merged.marginBottomPx,
    run: {
      fontFamily: merged.run.fontFamily ?? DEFAULT_FONT,
      fontSizePx: merged.run.fontSizePx ?? DEFAULT_SIZE_PX,
      ...omitUndefined(merged.run),
    },
  }
}

export function runFace(
  run: DocumentTextRunWire,
  paragraph: ParagraphFace,
  styles: DocumentStyleWire[],
): RunFace {
  const chain = styleChain(styles, run.styleId)
  const merged = mergeRun(
    paragraph.run,
    ...chain.map((style) => faceFromXml(style.sourceFragment).run),
    faceFromXml(run.preservedXmlFragments.join('')).run,
  )
  return {
    fontFamily: merged.fontFamily ?? DEFAULT_FONT,
    fontSizePx: merged.fontSizePx ?? DEFAULT_SIZE_PX,
    ...omitUndefined(merged),
  }
}

export function paragraphCss(face: ParagraphFace): CSSProperties {
  return omitUndefined({
    fontFamily: face.run.fontFamily,
    fontSize: face.run.fontSizePx,
    lineHeight: face.lineHeight,
    marginTop: face.marginTopPx,
    marginBottom: face.marginBottomPx,
    textAlign: face.align,
    paddingLeft: face.indentLeftPx,
    paddingRight: face.indentRightPx,
    textIndent: face.indentFirstPx,
    fontWeight: face.run.bold === undefined ? undefined : face.run.bold ? 700 : 400,
    fontStyle:
      face.run.italic === undefined
        ? undefined
        : face.run.italic
          ? 'italic'
          : 'normal',
  })
}

export function runCss(face: RunFace): CSSProperties {
  return omitUndefined({
    fontFamily: face.fontFamily,
    fontSize: face.fontSizePx,
    color: face.color,
    fontWeight: face.bold === undefined ? undefined : face.bold ? 700 : 400,
    fontStyle:
      face.italic === undefined ? undefined : face.italic ? 'italic' : 'normal',
    textDecoration:
      face.underline === undefined
        ? undefined
        : face.underline
          ? 'underline'
          : 'none',
  })
}

function styleChain(
  styles: DocumentStyleWire[],
  styleId: string | undefined,
): DocumentStyleWire[] {
  const chain: DocumentStyleWire[] = []
  const seen = new Set<string>()
  let current = styleId
  while (current && !seen.has(current)) {
    seen.add(current)
    const style = styles.find((item) => item.styleId === current)
    if (!style) break
    chain.unshift(style)
    current = style.basedOnStyleId
  }
  const normal = styles.find((item) => item.styleId === 'Normal')
  if (normal && !seen.has('Normal')) chain.unshift(normal)
  return chain
}

function faceFromXml(xml: string): ParagraphFace {
  const pPrBlock = xml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i)?.[0] ?? ''
  const rest = xml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/i, '')
  const pPr = pPrBlock || rest
  const rPr = xmlInner(rest, 'rPr') ?? xmlInner(pPrBlock, 'rPr') ?? rest
  const jc = xmlAttr(xmlTagAttrs(pPr, 'jc'), 'val')?.toLowerCase()
  const spacing = xmlTagAttrs(pPr, 'spacing')
  const ind = xmlTagAttrs(pPr, 'ind')
  const line = xmlNumber(spacing, 'line')
  const lineRule = xmlAttr(spacing, 'lineRule')?.toLowerCase()
  return {
    align: paragraphAlign(jc),
    marginTopPx: twipPx(xmlNumber(spacing, 'before')),
    marginBottomPx: twipPx(xmlNumber(spacing, 'after')),
    lineHeight: lineHeight(line, lineRule),
    indentLeftPx: twipPx(xmlNumber(ind, 'left')),
    indentRightPx: twipPx(xmlNumber(ind, 'right')),
    indentFirstPx: twipPx(xmlNumber(ind, 'firstLine')),
    run: runFromXml(rPr),
  }
}

function runFromXml(xml: string): RunFace {
  const fonts = xmlTagAttrs(xml, 'rFonts')
  const named = xmlAttr(fonts, 'ascii') ?? xmlAttr(fonts, 'hAnsi')
  const theme = (
    xmlAttr(fonts, 'asciiTheme') ?? xmlAttr(fonts, 'hAnsiTheme')
  )?.toLowerCase()
  const size = xmlNumber(xmlTagAttrs(xml, 'sz'), 'val')
  const color = xmlAttr(xmlTagAttrs(xml, 'color'), 'val')
  return omitUndefined({
    fontFamily: named
      ? `"${named}", ${DEFAULT_FONT}`
      : theme && THEME_FONT[theme]
        ? `${THEME_FONT[theme]}, ${DEFAULT_FONT}`
        : undefined,
    fontSizePx: size !== undefined ? halfPointToPx(size) : undefined,
    color:
      color && /^[0-9A-Fa-f]{6}$/.test(color) && color.toLowerCase() !== 'auto'
        ? `#${color}`
        : undefined,
    bold: wordToggle(xml, 'b'),
    italic: wordToggle(xml, 'i'),
    underline: wordUnderline(xml),
  })
}

function paragraphAlign(jc: string | undefined): ParagraphFace['align'] {
  if (jc === 'center') return 'center'
  if (jc === 'right' || jc === 'end') return 'right'
  if (jc === 'left' || jc === 'start') return 'left'
  if (jc === 'both' || jc === 'justify' || jc === 'distribute') return 'justify'
  return undefined
}

function mergeParagraph(...faces: ParagraphFace[]): ParagraphFace {
  return faces.reduce<ParagraphFace>(
    (current, next) => ({
      align: next.align ?? current.align,
      marginTopPx: next.marginTopPx || current.marginTopPx,
      marginBottomPx: next.marginBottomPx || current.marginBottomPx,
      lineHeight: next.lineHeight ?? current.lineHeight,
      indentLeftPx: next.indentLeftPx ?? current.indentLeftPx,
      indentRightPx: next.indentRightPx ?? current.indentRightPx,
      indentFirstPx: next.indentFirstPx ?? current.indentFirstPx,
      run: mergeRun(current.run, next.run),
    }),
    { marginTopPx: 0, marginBottomPx: 0, run: {} },
  )
}

function mergeRun(...faces: RunFace[]): RunFace {
  return faces.reduce<RunFace>(
    (current, next) => ({ ...current, ...omitUndefined(next) }),
    {},
  )
}

function lineHeight(
  line: number | undefined,
  rule: string | undefined,
): string | undefined {
  if (line === undefined) return undefined
  if (rule === 'exact' || rule === 'atleast') return `${twipToPx(line)}px`
  return String(line / 240)
}

function twipPx(value: number | undefined): number {
  return value === undefined ? 0 : twipToPx(value)
}

function wordToggle(xml: string, name: 'b' | 'i'): boolean | undefined {
  const attrs = xmlTagAttrs(xml, name)
  if (attrs === undefined && !new RegExp(`<w:${name}\\b`, 'i').test(xml)) {
    return undefined
  }
  const value = xmlAttr(attrs, 'val')?.toLowerCase()
  if (value === '0' || value === 'false' || value === 'off') return false
  return true
}

function wordUnderline(xml: string): boolean | undefined {
  const attrs = xmlTagAttrs(xml, 'u')
  if (attrs === undefined) return undefined
  const value = xmlAttr(attrs, 'val')?.toLowerCase()
  if (value === 'none' || value === '0' || value === 'false') return false
  return true
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
