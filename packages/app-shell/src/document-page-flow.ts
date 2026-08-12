import { lineInset, type PageFloat } from './document-page-floats'
import type { ColumnFrame, ContentFrame } from './document-page-layout'

export function takeFragment(input: {
  text: string
  offset: number
  startY: number
  maxY: number
  linePx: number
  fontSize: number
  indent: number
  column: ColumnFrame
  frame: ContentFrame
  floats: PageFloat[]
}): {
  consumed: number
  heightPx: number
  padLeftPx: number
  padRightPx: number
  skipTo?: number
} {
  if (!input.text) {
    return { consumed: 0, heightPx: input.linePx, padLeftPx: 0, padRightPx: 0 }
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
    const taken = takeLine(input.text, offset, input.fontSize, width)
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
  }
}

function takeLine(
  text: string,
  offset: number,
  fontSizePx: number,
  widthPx: number,
): number {
  const rest = text.slice(offset)
  if (!rest) return 0
  const perLine = Math.max(
    1,
    Math.floor(widthPx / Math.max(1, fontSizePx * 0.5)),
  )
  if (rest.length <= perLine) return rest.length
  const window = rest.slice(0, perLine)
  const space = window.lastIndexOf(' ')
  if (space > 0) return space + 1
  return perLine
}
