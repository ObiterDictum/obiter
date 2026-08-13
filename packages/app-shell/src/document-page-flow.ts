import { lineInset, type PageFloat } from './document-page-floats'
import type { ColumnFrame, ContentFrame } from './document-page-layout'

export const MEASURE_FONT = 'Calibri, "Segoe UI", "Liberation Sans", sans-serif'

export type WrappedLine = {
  text: string
  from: number
  to: number
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
  column: ColumnFrame
  frame: ContentFrame
  floats: PageFloat[]
}): {
  consumed: number
  heightPx: number
  padLeftPx: number
  padRightPx: number
  lines: number
  skipTo?: number
} {
  if (!input.text) {
    return {
      consumed: 0,
      heightPx: input.linePx,
      padLeftPx: 0,
      padRightPx: 0,
      lines: 1,
    }
  }
  let y = input.startY
  let offset = input.offset
  let padLeftPx = 0
  let padRightPx = 0
  let lines = 0
  let padsLocked = false
  while (offset < input.text.length) {
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
          consumed: 0,
          heightPx: 0,
          padLeftPx: 0,
          padRightPx: 0,
          lines: 0,
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
    const width = Math.max(
      1,
      input.column.widthPx - input.indent - padLeftPx - padRightPx,
    )
    const taken = takeLine(
      input.text,
      offset,
      input.fontSize,
      width,
      input.fontFamily,
    )
    if (taken === 0) break
    offset += taken
    y += input.linePx
    lines += 1
  }
  return {
    consumed: offset - input.offset,
    heightPx: Math.max(input.linePx, lines * input.linePx),
    padLeftPx,
    padRightPx,
    lines,
  }
}

export function countLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
): number {
  if (!text) return 1
  let offset = 0
  let lines = 0
  while (offset < text.length) {
    const taken = takeLine(text, offset, fontSizePx, widthPx, fontFamily)
    if (taken === 0) break
    offset += taken
    lines += 1
  }
  return Math.max(1, lines)
}

export function wrapLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
): WrappedLine[] {
  if (!text) return [{ text: '', from: 0, to: 0 }]
  const lines: WrappedLine[] = []
  let offset = 0
  while (offset < text.length) {
    const taken = takeLine(text, offset, fontSizePx, widthPx, fontFamily)
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
  return lines.length > 0 ? lines : [{ text: '', from: 0, to: 0 }]
}

export function takeLine(
  text: string,
  offset: number,
  fontSizePx: number,
  widthPx: number,
  fontFamily = MEASURE_FONT,
): number {
  const rest = text.slice(offset)
  if (!rest) return 0
  if (rest.startsWith('\n')) return 1
  const newline = rest.indexOf('\n')
  const haystack = newline === -1 ? rest : rest.slice(0, newline)
  if (textWidthPx(haystack, fontSizePx, fontFamily) <= widthPx) {
    return newline === -1 ? rest.length : newline + 1
  }
  const first = haystack[0]
  if (first && textWidthPx(first, fontSizePx, fontFamily) > widthPx) return 1
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
    ctx.font = `${fontSizePx}px ${fontFamily}`
    const width = ctx.measureText(text).width
    if (width > 0) return width
  }
  return glyphStringWidth(text, fontSizePx)
}

let measureCtx: CanvasRenderingContext2D | null | undefined

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
