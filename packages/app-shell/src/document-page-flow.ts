import { lineInset, type PageFloat } from './document-page-floats'
import type { ColumnFrame, ContentFrame } from './document-page-layout'
import {
  paragraphTextIndentPx,
  type ParagraphFace,
} from './document-page-style'

export const MEASURE_FONT = 'Calibri, "Segoe UI", "Liberation Sans", sans-serif'

export type WrappedLine = {
  text: string
  from: number
  to: number
}

export type TakeFragmentResult = {
  shown: number
  consumed: number
  heightPx: number
  padLeftPx: number
  padRightPx: number
  lines: number
  complete: boolean
  skipTo?: number
}

export function takeFragment(input: {
  text: string
  offset: number
  startY: number
  maxY: number
  linePx: number
  fontSize: number
  fontFamily?: string
  indent: number
  textIndentPx?: number
  column: ColumnFrame
  frame: ContentFrame
  floats: PageFloat[]
}): TakeFragmentResult {
  if (!input.text) {
    return {
      shown: 0,
      consumed: 0,
      heightPx: input.linePx,
      padLeftPx: 0,
      padRightPx: 0,
      lines: 1,
      complete: true,
    }
  }
  let y = input.startY
  let offset = input.offset
  let shown = 0
  let padLeftPx = 0
  let padRightPx = 0
  let lines = 0
  let padsLocked = false
  let trailingRow = input.text.endsWith('\n')
  while (offset < input.text.length || trailingRow) {
    const inset = lineInset(
      input.frame.top + y,
      input.linePx,
      input.column,
      input.frame,
      input.floats,
    )
    if (inset.skipTo !== undefined) {
      if (lines === 0) {
        return {
          shown: 0,
          consumed: 0,
          heightPx: 0,
          padLeftPx: 0,
          padRightPx: 0,
          lines: 0,
          complete: false,
          skipTo: inset.skipTo,
        }
      }
      break
    }
    if (y + input.linePx > input.maxY) break
    if (
      padsLocked &&
      (inset.padLeftPx !== padLeftPx || inset.padRightPx !== padRightPx)
    ) {
      break
    }
    padLeftPx = inset.padLeftPx
    padRightPx = inset.padRightPx
    padsLocked = true
    if (offset < input.text.length) {
      const firstRow = input.offset === 0 && lines === 0
      const width = Math.max(
        1,
        input.column.widthPx -
          input.indent -
          padLeftPx -
          padRightPx -
          (firstRow ? (input.textIndentPx ?? 0) : 0),
      )
      const taken = takeLine(
        input.text,
        offset,
        input.fontSize,
        width,
        input.fontFamily,
      )
      if (taken === 0) break
      const raw = input.text.slice(offset, offset + taken)
      const display = raw.endsWith('\n') ? raw.length - 1 : raw.length
      shown = offset - input.offset + display
      offset += taken
    } else {
      shown = offset - input.offset
      trailingRow = false
    }
    y += input.linePx
    lines += 1
  }
  return {
    shown,
    consumed: offset - input.offset,
    heightPx: Math.max(input.linePx, lines * input.linePx),
    padLeftPx,
    padRightPx,
    lines,
    complete: !trailingRow && offset >= input.text.length,
  }
}

export function countLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
  textIndentPx = 0,
): number {
  if (!text) return 1
  let offset = 0
  let lines = 0
  while (offset < text.length) {
    const taken = takeLine(
      text,
      offset,
      fontSizePx,
      Math.max(1, widthPx - (offset === 0 ? textIndentPx : 0)),
      fontFamily,
    )
    if (taken === 0) break
    offset += taken
    lines += 1
  }
  return Math.max(1, lines) + (text.endsWith('\n') ? 1 : 0)
}

export function firstLineIndentPx(
  face: ParagraphFace,
  bodyEdge: boolean,
): number {
  return bodyEdge ? 0 : paragraphTextIndentPx(face)
}

export function wrapLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
  textIndentPx = 0,
): WrappedLine[] {
  if (!text) return [{ text: '', from: 0, to: 0 }]
  const lines: WrappedLine[] = []
  let offset = 0
  while (offset < text.length) {
    const taken = takeLine(
      text,
      offset,
      fontSizePx,
      Math.max(1, widthPx - (offset === 0 ? textIndentPx : 0)),
      fontFamily,
    )
    if (taken === 0) break
    const raw = text.slice(offset, offset + taken)
    const display = raw.endsWith('\n') ? raw.slice(0, -1) : raw
    lines.push({
      text: display,
      from: offset,
      to: offset + display.length,
    })
    offset += taken
  }
  if (text.endsWith('\n')) {
    lines.push({ text: '', from: text.length, to: text.length })
  }
  return lines.length > 0 ? lines : [{ text: '', from: 0, to: 0 }]
}

const LINE_BREAK_CACHE_TEXTS = 5_000
const lineBreaks = new Map<string, Map<string, number>>()
let fontsWatched = false

export function clearLineBreakCache() {
  lineBreaks.clear()
  measuredFont = ''
}

function watchFontLoads() {
  if (fontsWatched) return
  fontsWatched = true
  if (typeof document === 'undefined' || !document.fonts) return
  document.fonts.addEventListener('loadingdone', clearLineBreakCache)
}

export function takeLine(
  text: string,
  offset: number,
  fontSizePx: number,
  widthPx: number,
  fontFamily = MEASURE_FONT,
): number {
  if (offset >= text.length) return 0
  watchFontLoads()
  let breaks = lineBreaks.get(text)
  if (!breaks) {
    if (lineBreaks.size >= LINE_BREAK_CACHE_TEXTS) lineBreaks.clear()
    breaks = new Map()
    lineBreaks.set(text, breaks)
  }
  const key = `${offset}\u0000${fontSizePx}\u0000${widthPx}\u0000${fontFamily}`
  const cached = breaks.get(key)
  if (cached !== undefined) return cached
  const taken = measureLine(text.slice(offset), fontSizePx, widthPx, fontFamily)
  breaks.set(key, taken)
  return taken
}

function measureLine(
  rest: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily: string,
): number {
  if (rest.startsWith('\n')) return 1
  const newline = rest.indexOf('\n')
  const haystack = newline === -1 ? rest : rest.slice(0, newline)
  if (textWidthPx(haystack, fontSizePx, fontFamily) <= widthPx) {
    return newline === -1 ? rest.length : newline + 1
  }
  const first = haystack[0]
  if (first && textWidthPx(first, fontSizePx, fontFamily) > widthPx) {
    return newline === 1 ? 2 : 1
  }
  let lo = 1
  let hi = haystack.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (
      textWidthPx(haystack.slice(0, mid), fontSizePx, fontFamily) <= widthPx
    ) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  let lastBreak = 0
  for (let index = 0; index < lo; index += 1) {
    const char = haystack[index]
    if (char === ' ' || char === '-') lastBreak = index + 1
  }
  if (lastBreak > 0) return lastBreak
  for (let index = lo; index < haystack.length; index += 1) {
    const char = haystack[index]
    if (char === ' ' || char === '-') return index + 1
  }
  return newline === -1 ? rest.length : newline + 1
}

function textWidthPx(
  text: string,
  fontSizePx: number,
  fontFamily: string,
): number {
  if (!text) return 0
  const ctx = measureContext()
  if (ctx) {
    const font = `${fontSizePx}px ${fontFamily}`
    if (measuredFont !== font) {
      ctx.font = font
      measuredFont = font
    }
    const width = ctx.measureText(text).width
    if (width > 0) return width
  }
  return glyphStringWidth(text, fontSizePx)
}

let measureCtx: CanvasRenderingContext2D | null | undefined
let measuredFont = ''

function measureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  if (
    typeof document === 'undefined' ||
    (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))
  ) {
    measureCtx = null
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      measureCtx = null
      return null
    }
    ctx.font = `16px ${MEASURE_FONT}`
    if (ctx.measureText('M').width === 0) {
      measureCtx = null
      return null
    }
    measureCtx = ctx
    return ctx
  } catch {
    measureCtx = null
    return null
  }
}

function glyphStringWidth(text: string, fontSizePx: number): number {
  let width = 0
  for (const char of text) width += glyphWidth(char, fontSizePx)
  return width
}

function glyphWidth(char: string, fontSizePx: number): number {
  if (char === ' ' || char === '\u00a0') return fontSizePx * 0.226
  if (char === '\t') return fontSizePx * 2
  if ('WM@%m'.includes(char)) return fontSizePx * 0.78
  if ("ilI.,:;!|'`.()[]{}".includes(char)) return fontSizePx * 0.28
  if ('ftjrs-'.includes(char)) return fontSizePx * 0.36
  return fontSizePx * 0.5
}
