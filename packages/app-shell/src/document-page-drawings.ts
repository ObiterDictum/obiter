import {
  drawingHasPicture,
  drawingIsTextBox,
  drawingShapeFill,
} from './document-page-media'
import { emuToPx } from './document-page-units'

export type DrawingPart = {
  kind: 'rect' | 'picture'
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
  fill?: string
  xml: string
}

export type DrawingScene = {
  widthPx: number
  heightPx: number
  parts: DrawingPart[]
}

export function drawingScene(xml: string): DrawingScene {
  const grouped = wordGroupParts(xml) ?? vmlGroupParts(xml)
  if (grouped && grouped.parts.length > 0) return grouped
  const size = extentBox(xml) ?? { widthPx: 180, heightPx: 48 }
  if (drawingIsTextBox(xml)) {
    return { ...size, parts: [] }
  }
  const fill = drawingShapeFill(xml)
  const kind = drawingHasPicture(xml) ? 'picture' : 'rect'
  if (kind === 'rect' && !fill) return { ...size, parts: [] }
  return {
    ...size,
    parts: [
      {
        kind,
        leftPx: 0,
        topPx: 0,
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        ...(fill ? { fill } : {}),
        xml,
      },
    ],
  }
}

function wordGroupParts(xml: string): DrawingScene | undefined {
  const group = taggedBlock(xml, 'wgp')
  if (!group) return undefined
  const resolved = drawingShapeFill(xml)
  const parts: DrawingPart[] = []
  for (const block of taggedBlocks(group, 'wsp')) {
    if (drawingIsTextBox(block)) continue
    const box = xfrmBox(block)
    if (!box) continue
    const fill = resolved ?? drawingShapeFill(block)
    if (!fill) continue
    parts.push({ kind: 'rect', ...box, fill, xml: block })
  }
  for (const block of taggedBlocks(group, 'pic')) {
    const box = xfrmBox(block)
    if (!box) continue
    parts.push({ kind: 'picture', ...box, xml: block })
  }
  if (parts.length === 0) return undefined
  const size = xfrmBox(group) ?? sceneBounds(parts)
  return { widthPx: size.widthPx, heightPx: size.heightPx, parts }
}

function vmlGroupParts(xml: string): DrawingScene | undefined {
  const group = xml.match(/<v:group\b([^>]*)>([\s\S]*?)<\/v:group>/i)
  if (!group) return undefined
  const style = group[1]?.match(/\bstyle="([^"]*)"/i)?.[1] ?? ''
  const coord = group[1]?.match(/\bcoordsize="(\d+)\s*,\s*(\d+)"/i)
  const widthPx = cssPtPx(style, 'width')
  const heightPx = cssPtPx(style, 'height')
  const coordW = Number(coord?.[1])
  const coordH = Number(coord?.[2])
  if (!widthPx || !heightPx || !coordW || !coordH) return undefined
  const body = group[2] ?? ''
  const resolved = drawingShapeFill(xml)
  const parts: DrawingPart[] = []
  for (const block of body.match(/<v:rect\b[\s\S]*?(?:\/>|<\/v:rect>)/gi) ??
    []) {
    const box = vmlChildBox(block, widthPx, heightPx, coordW, coordH)
    if (!box) continue
    const fill = resolved ?? drawingShapeFill(block)
    if (!fill) continue
    parts.push({ kind: 'rect', ...box, fill, xml: block })
  }
  for (const block of body.match(/<v:shape\b[\s\S]*?<\/v:shape>/gi) ?? []) {
    if (!/<v:imagedata\b/i.test(block)) continue
    const box = vmlChildBox(block, widthPx, heightPx, coordW, coordH)
    if (!box) continue
    parts.push({ kind: 'picture', ...box, xml: block })
  }
  if (parts.length === 0) return undefined
  return { widthPx, heightPx, parts }
}

export function drawingAnchor(
  xml: string,
): { leftPx: number; topPx: number } | undefined {
  if (!/<wp:anchor\b/i.test(xml)) return undefined
  return {
    leftPx: axisOffset(xml, 'positionH'),
    topPx: axisOffset(xml, 'positionV'),
  }
}

function axisOffset(xml: string, tag: 'positionH' | 'positionV'): number {
  const block = xml.match(
    new RegExp(`<wp:${tag}\\b[\\s\\S]*?</wp:${tag}>`, 'i'),
  )?.[0]
  if (!block) return 0
  const offset = block.match(/<wp:posOffset>([-\d]+)<\/wp:posOffset>/i)?.[1]
  if (offset === undefined) return 0
  const emu = Number(offset)
  return Number.isFinite(emu) ? Math.round(emuToPx(emu)) : 0
}

function taggedBlock(xml: string, localName: string): string | undefined {
  return taggedBlocks(xml, localName)[0]
}

function taggedBlocks(xml: string, localName: string): string[] {
  return [
    ...xml.matchAll(
      new RegExp(
        `<(?:\\w+:)?${localName}\\b[\\s\\S]*?</(?:\\w+:)?${localName}>`,
        'gi',
      ),
    ),
  ].map((match) => match[0])
}

function xfrmBox(xml: string):
  | {
      leftPx: number
      topPx: number
      widthPx: number
      heightPx: number
    }
  | undefined {
  const off = xml.match(
    /<a:off\b[^>]*x="(\d+)"[^>]*y="(\d+)"|<a:off\b[^>]*y="(\d+)"[^>]*x="(\d+)"/i,
  )
  const ext = xml.match(
    /<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"|<a:ext\b[^>]*cy="(\d+)"[^>]*cx="(\d+)"/i,
  )
  if (!ext) return undefined
  const cx = Number(ext[1] || ext[4])
  const cy = Number(ext[2] || ext[3])
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) {
    return undefined
  }
  const x = Number(off?.[1] || off?.[4] || 0)
  const y = Number(off?.[2] || off?.[3] || 0)
  return {
    leftPx: emuPx(x),
    topPx: emuPx(y),
    widthPx: Math.max(1, emuPx(cx)),
    heightPx: Math.max(1, emuPx(cy)),
  }
}

function extentBox(
  xml: string,
): { widthPx: number; heightPx: number } | undefined {
  const box = xfrmBox(xml)
  if (box) return { widthPx: box.widthPx, heightPx: box.heightPx }
  const extent = xml.match(
    /<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"|<wp:extent\b[^>]*cy="(\d+)"[^>]*cx="(\d+)"/i,
  )
  if (!extent) return undefined
  const cx = Number(extent[1] || extent[4])
  const cy = Number(extent[2] || extent[3])
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) {
    return undefined
  }
  return { widthPx: Math.max(1, emuPx(cx)), heightPx: Math.max(1, emuPx(cy)) }
}

function vmlChildBox(
  xml: string,
  groupW: number,
  groupH: number,
  coordW: number,
  coordH: number,
): Omit<DrawingPart, 'kind' | 'xml' | 'fill'> | undefined {
  const style = xml.match(/\bstyle="([^"]*)"/i)?.[1] ?? ''
  const left = Number(style.match(/\bleft:\s*([\d.]+)/i)?.[1] ?? 0)
  const top = Number(style.match(/\btop:\s*([\d.]+)/i)?.[1] ?? 0)
  const width = Number(style.match(/\bwidth:\s*([\d.]+)/i)?.[1])
  const height = Number(style.match(/\bheight:\s*([\d.]+)/i)?.[1])
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }
  return {
    leftPx: Math.round((left / coordW) * groupW),
    topPx: Math.round((top / coordH) * groupH),
    widthPx: Math.max(1, Math.round((width / coordW) * groupW)),
    heightPx: Math.max(1, Math.round((height / coordH) * groupH)),
  }
}

function cssPtPx(style: string, name: string): number | undefined {
  const match = style.match(new RegExp(`\\b${name}:\\s*([\\d.]+)pt`, 'i'))
  const value = Number(match?.[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.max(1, Math.round((value * 96) / 72))
}

function sceneBounds(parts: DrawingPart[]): {
  widthPx: number
  heightPx: number
} {
  return {
    widthPx: Math.max(1, ...parts.map((part) => part.leftPx + part.widthPx)),
    heightPx: Math.max(1, ...parts.map((part) => part.topPx + part.heightPx)),
  }
}

function emuPx(value: number): number {
  return Math.max(0, Math.round(emuToPx(value)))
}
