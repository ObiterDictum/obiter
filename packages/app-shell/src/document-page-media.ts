import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentRelationshipWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { resolveRelationshipTarget } from '@obiter/ooxml'
import { emuToPx } from './document-page-units'

const IMAGE_MARK =
  /<w:drawing\b|<w:pict\b|<v:imagedata\b|<a:blip\b|<pic:pic\b|<w:object\b/i
const BOLD_TAG = /<w:b\b([^>]*)\/?>/i
const ITALIC_TAG = /<w:i\b([^>]*)\/?>/i

export function xmlContainsImage(xml: string): boolean {
  return IMAGE_MARK.test(xml)
}

export function paragraphImageXml(paragraph: DocumentParagraphWire): string[] {
  return [
    ...paragraph.preservedXmlFragments.filter(xmlContainsImage),
    ...paragraph.runs.flatMap((run) =>
      run.preservedXmlFragments.filter(xmlContainsImage),
    ),
  ]
}

export function paragraphHasImage(paragraph: DocumentParagraphWire): boolean {
  return paragraphImageXml(paragraph).length > 0
}

export function marginStoryVisible(story: DocumentStoryWire): boolean {
  return (
    story.preservedXmlFragments.some(xmlContainsImage) ||
    story.preservedXmlFragments.some((xml) => xml.includes('<w:tbl')) ||
    story.paragraphs.some(paragraphHasImage) ||
    story.paragraphs.some((paragraph) =>
      paragraph.runs.some(
        (run) =>
          run.text.trim().length > 0 ||
          /\bPAGE\b/i.test(run.preservedXmlFragments.join('')),
      ),
    )
  )
}

export function paragraphAlignClass(
  paragraph: DocumentParagraphWire,
): string | undefined {
  const xml = paragraph.preservedXmlFragments.join('')
  const match = xml.match(/<w:jc\b[^>]*w:val="([^"]+)"/i)
  const value = match?.[1]?.toLowerCase()
  if (value === 'center') return 'text-center'
  if (value === 'right' || value === 'end') return 'text-right'
  return undefined
}

export function runEmphasisClass(run: DocumentTextRunWire): string | undefined {
  const xml = run.preservedXmlFragments.join('')
  const classes: string[] = []
  if (wordToggleOn(xml, 'b')) classes.push('font-semibold')
  if (wordToggleOn(xml, 'i')) classes.push('italic')
  if (wordUnderlineOn(xml)) classes.push('underline')
  return classes.length > 0 ? classes.join(' ') : undefined
}

export function runColor(run: DocumentTextRunWire): string | undefined {
  const value = run.preservedXmlFragments
    .join('')
    .match(/<w:color\b[^>]*w:val="([^"]+)"/i)?.[1]
  if (!value || value.toLowerCase() === 'auto') return undefined
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) return undefined
  return `#${value}`
}

export function readableRunColor(
  color: string | undefined,
  background?: string,
): string | undefined {
  if (!color) return undefined
  if (background && colourLuminance(background) < 0.45) return color
  if (colourLuminance(color) > 0.82) return undefined
  return color
}

export function paragraphFill(
  paragraph: DocumentParagraphWire,
): string | undefined {
  const xml = paragraph.preservedXmlFragments.join('')
  const fill = xml.match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/i)?.[1]
  if (fill && fill.toLowerCase() !== 'auto') return `#${fill}`
  const theme = xml.match(/<w:shd\b[^>]*w:themeFill="([^"]+)"/i)?.[1]
  if (theme?.toLowerCase() === 'dk1' || theme?.toLowerCase() === 'dk2') {
    return '#3A3A3A'
  }
  return undefined
}

export function drawingHasPicture(xml: string): boolean {
  return /<a:blip\b|<v:imagedata\b|<pic:pic\b/i.test(xml)
}

export function drawingShapeFill(xml: string): string | undefined {
  if (drawingIsTextBox(xml)) return undefined
  return drawingSolidFill(xml)
}

export function drawingSolidFill(xml: string): string | undefined {
  const srgb = xml.match(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/i)?.[1]
  if (srgb) return `#${srgb}`
  const vml =
    xml.match(/\bfillcolor="#?([0-9A-Fa-f]{6})\b/i)?.[1] ??
    xml.match(/<v:fill\b[^>]*\bcolor="#?([0-9A-Fa-f]{6})\b/i)?.[1]
  if (vml) return `#${vml}`
  const scheme = xml
    .match(/<a:schemeClr\b[^>]*val="([^"]+)"/i)?.[1]
    ?.toLowerCase()
  if (scheme === 'dk1' || scheme === 'tx1') return '#000000'
  if (scheme === 'dk2' || scheme === 'tx2') return '#44546A'
  if (scheme === 'bg1' || scheme === 'lt1') return '#FFFFFF'
  if (scheme === 'bg2' || scheme === 'lt2') return '#E7E6E6'
  if (scheme === 'accent1') return '#4472C4'
  const named = xml.match(
    /\bfillcolor="(gray|grey|silver|darkgray|darkgrey)"/i,
  )?.[1]
  if (named) {
    const value = named.toLowerCase()
    if (value === 'silver') return '#C0C0C0'
    return '#A6A6A6'
  }
  return undefined
}

export function drawingIsTextBox(xml: string): boolean {
  return /<w:txbxContent\b|<wps:txbxContent\b|<v:textbox\b/i.test(xml)
}

export function contrastFillText(background?: string): string | undefined {
  if (!background) return undefined
  return colourLuminance(background) < 0.45 ? '#FFFFFF' : undefined
}

function colourLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(value)) return 0.5
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function drawingBoxSize(xml: string): { width: number; height: number } {
  const extent = xml.match(
    /<(?:wp:extent|a:ext)\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"|<(?:wp:extent|a:ext)\b[^>]*cy="(\d+)"[^>]*cx="(\d+)"/i,
  )
  if (extent) {
    const cx = Number(extent[1] || extent[4])
    const cy = Number(extent[2] || extent[3])
    if (Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0) {
      return {
        width: Math.max(1, Math.round(emuToPx(cx))),
        height: Math.max(1, Math.round(emuToPx(cy))),
      }
    }
  }
  const vml = vmlBoxSize(xml)
  if (vml) return vml
  return { width: 180, height: 48 }
}

function vmlBoxSize(
  xml: string,
): { width: number; height: number } | undefined {
  const style = xml.match(/\bstyle="([^"]*)"/i)?.[1]
  if (!style) return undefined
  const width = cssLengthToPx(style.match(/\bwidth:\s*([\d.]+)(pt|in|px|mm)/i))
  const height = cssLengthToPx(
    style.match(/\bheight:\s*([\d.]+)(pt|in|px|mm)/i),
  )
  if (width === undefined || height === undefined) return undefined
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function cssLengthToPx(match: RegExpMatchArray | null): number | undefined {
  if (!match?.[1] || !match[2]) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = match[2].toLowerCase()
  if (unit === 'px') return value
  if (unit === 'pt') return (value * 96) / 72
  if (unit === 'in') return value * 96
  if (unit === 'mm') return (value * 96) / 25.4
  return undefined
}

export function tabColumns(
  paragraph: DocumentParagraphWire,
): DocumentTextRunWire[][] | undefined {
  const groups: DocumentTextRunWire[][] = [[]]
  let sawTab = false
  for (const run of paragraph.runs) {
    const tabCount = run.preservedXmlFragments.filter((xml) =>
      /<w:tab\b/.test(xml),
    ).length
    if (tabCount === 0) {
      groups[groups.length - 1]?.push(run)
      continue
    }
    sawTab = true
    if (
      run.text.trim() ||
      run.preservedXmlFragments.some((xml) => /<w:instrText\b/i.test(xml))
    ) {
      groups[groups.length - 1]?.push({
        ...run,
        preservedXmlFragments: run.preservedXmlFragments.filter(
          (xml) => !/<w:tab\b/.test(xml),
        ),
      })
    }
    for (let i = 0; i < tabCount; i += 1) groups.push([])
  }
  return sawTab ? groups : undefined
}

export function runDisplayText(
  run: DocumentTextRunWire,
  pageNumber = 1,
): string {
  const xml = run.preservedXmlFragments.join('')
  if (/<w:instrText\b/i.test(xml) && /\bPAGE\b/i.test(xml)) {
    return String(pageNumber)
  }
  if (run.text) return run.text
  return ''
}

export function imagePartNameForDrawing(
  xml: string,
  sourcePartName: string,
  relationships: DocumentRelationshipWire[],
): string | undefined {
  const embedId =
    xml.match(/\br:embed="([^"]+)"/i)?.[1] ??
    xml.match(/<v:imagedata\b[^>]*\br:id="([^"]+)"/i)?.[1]
  if (!embedId) return undefined
  const relationship = relationships.find(
    (item) => item.sourcePartName === sourcePartName && item.id === embedId,
  )
  if (!relationship) return undefined
  try {
    return resolveRelationshipTarget(relationship)
  } catch {
    return undefined
  }
}

export function documentImagePartNames(model: DocumentModelWire): string[] {
  const names = new Set<string>()
  for (const story of model.stories) {
    const fragments = [
      ...story.preservedXmlFragments,
      ...story.paragraphs.flatMap(paragraphImageXml),
    ]
    for (const xml of fragments) {
      const name = imagePartNameForDrawing(
        xml,
        story.partName,
        model.relationships,
      )
      if (name) names.add(name)
    }
  }
  return [...names]
}

function wordToggleOn(xml: string, name: 'b' | 'i'): boolean {
  const tag = xml.match(name === 'b' ? BOLD_TAG : ITALIC_TAG)
  if (!tag) return false
  const value = tag[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

function wordUnderlineOn(xml: string): boolean {
  const tag = xml.match(/<w:u\b([^>]*)\/?>/i)
  if (!tag) return false
  const value = tag[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return value !== 'none' && value !== '0' && value !== 'false'
}
