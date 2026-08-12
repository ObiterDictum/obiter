import type { DocumentParagraphWire } from '@obiter/contracts'
import { drawingScene } from './document-page-drawings'
import { drawingIsTextBox, paragraphImageXml } from './document-page-media'
import type { ColumnFrame, ContentFrame, PageBox } from './document-page-layout'
import { emuToPx, xmlAttr, xmlNumber } from './document-page-units'

export type WrapKind = 'none' | 'square' | 'topAndBottom'

export type FloatSpec = {
  xml: string
  paragraphId: string
  wrap: WrapKind
  behind: boolean
  isTextBox: boolean
  textBoxParaIds: string[]
  relativeFromH: 'page' | 'margin' | 'column' | 'paragraph'
  relativeFromV: 'page' | 'margin' | 'paragraph' | 'line'
  alignH?: 'left' | 'center' | 'right'
  offsetH: number
  offsetV: number
  dist: { top: number; right: number; bottom: number; left: number }
}

export type PageFloat = {
  xml: string
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
  wrap: WrapKind
  behind: boolean
  dist: { top: number; right: number; bottom: number; left: number }
}

export type PageTextBox = PageFloat & {
  paragraphIds: string[]
  fill?: string
}

export function paragraphAnchorXml(paragraph: DocumentParagraphWire): string[] {
  return paragraphImageXml(paragraph).filter((xml) => /<wp:anchor\b/i.test(xml))
}

export function paragraphInlineXml(paragraph: DocumentParagraphWire): string[] {
  return paragraphImageXml(paragraph).filter(
    (xml) => !/<wp:anchor\b/i.test(xml),
  )
}

export function drawingFloat(
  xml: string,
  paragraphId: string,
): FloatSpec | undefined {
  if (!/<wp:anchor\b/i.test(xml)) return undefined
  const open = xml.match(/<wp:anchor\b([^>]*)>/i)?.[1] ?? ''
  const positionH = axisBlock(xml, 'positionH')
  const positionV = axisBlock(xml, 'positionV')
  return {
    xml,
    paragraphId,
    wrap: wrapKind(xml),
    behind: xmlAttr(open, 'behindDoc') === '1',
    isTextBox: drawingIsTextBox(xml),
    textBoxParaIds: textBoxParagraphIds(xml),
    relativeFromH: relativeFrom(positionH, 'page'),
    relativeFromV: relativeFromV(positionV),
    alignH: axisAlign(positionH),
    offsetH: axisOffsetPx(positionH),
    offsetV: axisOffsetPx(positionV),
    dist: {
      top: emuPx(xmlNumber(open, 'distT') ?? 0),
      right: emuPx(xmlNumber(open, 'distR') ?? 0),
      bottom: emuPx(xmlNumber(open, 'distB') ?? 0),
      left: emuPx(xmlNumber(open, 'distL') ?? 0),
    },
  }
}

export function resolveFloat(
  spec: FloatSpec,
  box: PageBox,
  frame: ContentFrame,
  column: ColumnFrame,
  yInColumn: number,
): PageFloat {
  const scene = drawingScene(spec.xml)
  const widthPx = scene.widthPx
  const heightPx = scene.heightPx
  const hSpan =
    spec.relativeFromH === 'page'
      ? box.widthPx
      : spec.relativeFromH === 'column'
        ? column.widthPx
        : frame.widthPx
  let leftPx = spec.offsetH
  if (spec.alignH === 'left') leftPx = 0
  else if (spec.alignH === 'center') leftPx = (hSpan - widthPx) / 2
  else if (spec.alignH === 'right') leftPx = hSpan - widthPx
  if (spec.relativeFromH === 'margin') leftPx += frame.left
  else if (
    spec.relativeFromH === 'column' ||
    spec.relativeFromH === 'paragraph'
  ) {
    leftPx += frame.left + column.left
  }
  let topPx = spec.offsetV
  if (spec.relativeFromV === 'margin') topPx += frame.top
  else if (
    spec.relativeFromV === 'paragraph' ||
    spec.relativeFromV === 'line'
  ) {
    topPx += frame.top + yInColumn
  }
  return {
    xml: spec.xml,
    leftPx: Math.round(leftPx),
    topPx: Math.round(topPx),
    widthPx,
    heightPx,
    wrap: spec.wrap,
    behind: spec.behind,
    dist: spec.dist,
  }
}

export function lineInset(
  pageY: number,
  linePx: number,
  column: ColumnFrame,
  frame: ContentFrame,
  floats: PageFloat[],
): { padLeftPx: number; padRightPx: number; skipTo?: number } {
  const colLeft = frame.left + column.left
  const colRight = colLeft + column.widthPx
  let left = colLeft
  let right = colRight
  for (const item of floats) {
    if (item.wrap === 'none') continue
    const top = item.topPx - item.dist.top
    const bottom = item.topPx + item.heightPx + item.dist.bottom
    if (pageY + linePx <= top || pageY >= bottom) continue
    if (item.wrap === 'topAndBottom') {
      return { padLeftPx: 0, padRightPx: 0, skipTo: bottom - frame.top }
    }
    const obstacleLeft = item.leftPx - item.dist.left
    const obstacleRight = item.leftPx + item.widthPx + item.dist.right
    const leftGap = obstacleLeft - colLeft
    const rightGap = colRight - obstacleRight
    if (leftGap >= rightGap) right = Math.min(right, obstacleLeft)
    else left = Math.max(left, obstacleRight)
  }
  return {
    padLeftPx: Math.max(0, Math.round(left - colLeft)),
    padRightPx: Math.max(0, Math.round(colRight - right)),
  }
}

export function wrapKind(xml: string): WrapKind {
  if (/<wp:wrapTopAndBottom\b/i.test(xml)) return 'topAndBottom'
  if (/<wp:wrapNone\b/i.test(xml)) return 'none'
  return 'square'
}

export function textBoxParagraphIds(xml: string): string[] {
  const choice = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/gi, '')
  const ids = [...choice.matchAll(/w14:paraId="([^"]+)"/gi)].map(
    (match) => `para-w14-${match[1]}`,
  )
  return [...new Set(ids)]
}

function axisBlock(xml: string, tag: 'positionH' | 'positionV'): string {
  return (
    xml.match(new RegExp(`<wp:${tag}\\b[\\s\\S]*?</wp:${tag}>`, 'i'))?.[0] ?? ''
  )
}

function relativeFrom(
  block: string,
  fallback: FloatSpec['relativeFromH'],
): FloatSpec['relativeFromH'] {
  const value = block.match(/relativeFrom="([^"]+)"/i)?.[1]?.toLowerCase()
  if (value === 'page' || value === 'margin' || value === 'column') return value
  if (value === 'paragraph' || value === 'character') return 'paragraph'
  return fallback
}

function relativeFromV(block: string): FloatSpec['relativeFromV'] {
  const value = block.match(/relativeFrom="([^"]+)"/i)?.[1]?.toLowerCase()
  if (value === 'page' || value === 'margin' || value === 'line') return value
  return 'paragraph'
}

function axisAlign(block: string): FloatSpec['alignH'] | undefined {
  const value = block
    .match(/<wp:align>([^<]+)<\/wp:align>/i)?.[1]
    ?.toLowerCase()
  if (value === 'left' || value === 'center' || value === 'right') return value
  return undefined
}

function axisOffsetPx(block: string): number {
  const offset = block.match(/<wp:posOffset>([-\d]+)<\/wp:posOffset>/i)?.[1]
  if (offset === undefined) return 0
  const emu = Number(offset)
  return Number.isFinite(emu) ? Math.round(emuToPx(emu)) : 0
}

function emuPx(value: number): number {
  return Math.max(0, Math.round(emuToPx(value)))
}
