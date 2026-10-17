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
import type { HighlightValue } from './document-format-types'
import {
  runFlag,
  runHighlight,
  runUnderline,
  runVertAlign,
  withoutTrackedParagraphProperties,
} from './document-run-properties'

export type RunFace = {
  fontFamily?: string
  fontSizePx?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  highlight?: string
  vertAlign?: 'superscript' | 'subscript' | 'baseline'
}

export type ParagraphFace = {
  align?: 'left' | 'center' | 'right' | 'justify'
  marginTopPx?: number
  marginBottomPx?: number
  lineHeight?: string
  indentLeftPx?: number
  indentRightPx?: number
  indentFirstPx?: number
  /** A hanging indent: the first line hangs left of the body indent. */
  indentHangingPx?: number
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  run: RunFace
}

const DEFAULT_FONT = 'Calibri, "Segoe UI", "Liberation Sans", sans-serif'
const DEFAULT_SIZE_PX = halfPointToPx(22)
interface ThemeFont {
  [key: string]: string
}
const THEME_FONT: ThemeFont = {
  minorhansi: 'Calibri',
  minorascii: 'Calibri',
  majorhansi: 'Cambria',
  majorascii: 'Cambria',
}

// Word's closed highlight palette, so a DOCX authored in Word paints the same
// colour here. The editor's own Highlight control only ever writes `yellow`.
const HIGHLIGHT_COLOUR: ThemeFont = {
  yellow: '#FFFF00',
  green: '#00FF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  blue: '#0000FF',
  red: '#FF0000',
  darkblue: '#000080',
  darkcyan: '#008080',
  darkgreen: '#008000',
  darkmagenta: '#800080',
  darkred: '#800000',
  darkyellow: '#808000',
  darkgray: '#808080',
  lightgray: '#C0C0C0',
  black: '#000000',
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
    marginTopPx: merged.marginTopPx ?? 0,
    marginBottomPx: merged.marginBottomPx ?? 0,
    keepNext: merged.keepNext ?? false,
    keepLines: merged.keepLines ?? false,
    widowControl: merged.widowControl ?? true,
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

export function paragraphLineHeightPx(face: ParagraphFace): number {
  const size = face.run.fontSizePx ?? DEFAULT_SIZE_PX
  const line = face.lineHeight
  if (!line) return size * 1.15
  if (line.endsWith('px')) {
    const value = Number.parseFloat(line)
    return Number.isFinite(value) ? value : size * 1.15
  }
  const ratio = Number(line)
  return Number.isFinite(ratio) ? size * ratio : size * 1.15
}

/**
 * Line 1's offset from the body edge, in CSS `text-indent` terms: a positive
 * `w:firstLine` holds line 1 back from the body edge by that much, a `w:hanging`
 * starts it that far left of it, and neither leaves line 1 on the body edge. The
 * paint applies this as `text-indent` and the wrap takes it off line 1's width,
 * so both have to read the same number or they disagree about where line 1 ends.
 */
export function paragraphTextIndentPx(face: ParagraphFace): number {
  if (face.indentFirstPx) return face.indentFirstPx
  if (face.indentHangingPx) return -face.indentHangingPx
  return 0
}

export function paragraphCss(face: ParagraphFace): CSSProperties {
  return omitUndefined({
    fontFamily: face.run.fontFamily,
    fontSize: face.run.fontSizePx,
    lineHeight: `${paragraphLineHeightPx(face)}px`,
    marginTop: face.marginTopPx,
    marginBottom: face.marginBottomPx,
    textAlign: face.align,
    paddingLeft: face.indentLeftPx,
    paddingRight: face.indentRightPx,
    textIndent: paragraphTextIndentPx(face) || undefined,
    fontWeight:
      face.run.bold === undefined ? undefined : face.run.bold ? 700 : 400,
    fontStyle:
      face.run.italic === undefined
        ? undefined
        : face.run.italic
          ? 'italic'
          : 'normal',
  })
}

export function runCss(face: RunFace): CSSProperties {
  const superscript = face.vertAlign === 'superscript'
  const subscript = face.vertAlign === 'subscript'
  return omitUndefined({
    fontFamily: face.fontFamily,
    fontSize:
      (superscript || subscript) && face.fontSizePx !== undefined
        ? face.fontSizePx * 0.65
        : face.fontSizePx,
    color: face.color,
    backgroundColor: face.highlight,
    fontWeight: face.bold === undefined ? undefined : face.bold ? 700 : 400,
    fontStyle:
      face.italic === undefined ? undefined : face.italic ? 'italic' : 'normal',
    textDecoration: runTextDecoration(face),
    verticalAlign: superscript ? 'super' : subscript ? 'sub' : undefined,
  })
}

/**
 * Underline and strikethrough are independent decorations. An explicit `false`
 * on either clears that line (overriding an inherited style) without dropping
 * the other, which a single boolean could not express.
 */
function runTextDecoration(face: RunFace): CSSProperties['textDecoration'] {
  const lines: string[] = []
  if (face.underline === true) lines.push('underline')
  if (face.strike === true) lines.push('line-through')
  if (lines.length > 0) return lines.join(' ')
  if (face.underline === false || face.strike === false) return 'none'
  return undefined
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
  // Tracked history lives in nested `w:rPrChange`/`w:pPrChange` elements —
  // including the previous paragraph mark's `w:rPr` inside `w:pPrChange` — so
  // drop it before reading or a foreign change paints a value the current
  // paragraph no longer carries.
  const current = withoutTrackedParagraphProperties(xml)
  const pPrBlock = current.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i)?.[0] ?? ''
  const rest = current.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/i, '')
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
    indentHangingPx: twipPx(xmlNumber(ind, 'hanging')),
    keepNext: wordFlag(pPr, 'keepNext'),
    keepLines: wordFlag(pPr, 'keepLines'),
    widowControl: wordFlag(pPr, 'widowControl'),
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
    bold: runFlag(xml, 'b') ?? undefined,
    italic: runFlag(xml, 'i') ?? undefined,
    underline: runUnderline(xml) ?? undefined,
    strike: runFlag(xml, 'strike') ?? undefined,
    highlight: highlightColour(runHighlight(xml)),
    vertAlign: runVertAlign(xml) ?? undefined,
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
      // `??`, not `||`: a direct 0 spacing overrides a style's value.
      marginTopPx: next.marginTopPx ?? current.marginTopPx,
      marginBottomPx: next.marginBottomPx ?? current.marginBottomPx,
      lineHeight: next.lineHeight ?? current.lineHeight,
      indentLeftPx: next.indentLeftPx ?? current.indentLeftPx,
      indentRightPx: next.indentRightPx ?? current.indentRightPx,
      // First-line and hanging are mutually exclusive in OOXML: a face naming
      // either overrides both, or a direct `w:firstLine` would leave an
      // inherited `w:hanging` behind it (`indentKind` reads hanging first).
      indentFirstPx:
        next.indentFirstPx ??
        (next.indentHangingPx === undefined
          ? current.indentFirstPx
          : undefined),
      indentHangingPx:
        next.indentHangingPx ??
        (next.indentFirstPx === undefined
          ? current.indentHangingPx
          : undefined),
      keepNext: next.keepNext ?? current.keepNext,
      keepLines: next.keepLines ?? current.keepLines,
      widowControl: next.widowControl ?? current.widowControl,
      run: mergeRun(current.run, next.run),
    }),
    {
      keepNext: false,
      keepLines: false,
      widowControl: true,
      run: {},
    },
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

/**
 * Absent stays absent: `mergeParagraph` falls back to the style chain on
 * `undefined` but not on `0`, so mapping an absent attribute to 0 would let a
 * paragraph's silence override its style. `w:firstLine="0"` — Word's spelling
 * of "no indent" — is a real 0 and does override.
 */
function twipPx(value: number | undefined): number | undefined {
  return value === undefined ? undefined : twipToPx(value)
}

function wordFlag(xml: string, name: string): boolean | undefined {
  const attrs = xmlTagAttrs(xml, name)
  if (attrs === undefined && !new RegExp(`<w:${name}\\b`, 'i').test(xml)) {
    return undefined
  }
  const value = xmlAttr(attrs, 'val')?.toLowerCase()
  if (value === '0' || value === 'false' || value === 'off') return false
  return true
}

function highlightColour(value: HighlightValue | null): string | undefined {
  if (!value || value === 'none') return undefined
  return HIGHLIGHT_COLOUR[value.toLowerCase()]
}

function omitUndefined<T extends object>(value: T): T {
  // SAFETY: Object.entries yields T's own keys and the filter only drops undefined-valued entries, so the rebuilt object still matches T.
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
