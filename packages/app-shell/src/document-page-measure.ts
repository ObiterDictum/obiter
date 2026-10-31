import type { PendingRedlines } from './document-pending-redlines'
import { pendingParagraphChanges } from './document-pending-redlines'
import { paragraphPartName } from './document-inline-index'
import { inlineChanges, type InlineProjection } from './document-inline-changes'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { ExtraRuns } from './document-word-edits'
import { effectiveParagraph } from './document-model-text'
import { countLines, firstLineIndentPx } from './document-page-flow'
import {
  drawingFloat,
  paragraphAnchorXml,
  paragraphInlineXml,
  type FloatSpec,
} from './document-page-floats'
import { drawingScene } from './document-page-drawings'
import { paragraphListIndent } from './document-page-lists'
import {
  paragraphFace,
  paragraphLineHeightPx,
  type ParagraphFace,
} from './document-page-style'

export type ParagraphAnchor = {
  xml: string
  spec: FloatSpec
}

export type ParagraphFloatTargets = {
  host: boolean
  boxed: string[]
}

export type ParagraphMetrics = {
  linePx: number
  lineCount: number
  heightPx: number
  keepNext: boolean
  keepLines: boolean
  widowControl: boolean
}

export type ParagraphMeasure = {
  paragraph: DocumentParagraphWire
  text: string
  projection: InlineProjection
  face: ParagraphFace
  linePx: number
  fontSize: number
  indent: number
  textIndentPx: number
  imagePx: number
  pageBreaks: number[]
  anchors: ParagraphAnchor[]
  lineCounts: Map<string, number>
  metrics: Map<number, ParagraphMetrics>
}

type Measured = {
  styles: DocumentModelWire['styles']
  numbering: DocumentModelWire['numbering']
  changes: DocumentModelWire['changes']
  stories: DocumentModelWire['stories']
  pending: PendingRedlines | undefined
  measure: ParagraphMeasure
}

let measured = new WeakMap<DocumentParagraphWire, Measured>()
let floatTargets = new WeakMap<DocumentParagraphWire, ParagraphFloatTargets>()
let fontsWatched = false
const MAX_LINE_COUNTS = 64

export function clearParagraphMeasureCache(): void {
  measured = new WeakMap()
  floatTargets = new WeakMap()
}

function watchFontLoads() {
  if (fontsWatched) return
  fontsWatched = true
  if (typeof document === 'undefined' || !document.fonts) return
  document.fonts.addEventListener('loadingdone', clearParagraphMeasureCache)
}

export function paragraphMeasure(
  source: DocumentParagraphWire,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  pendingRedlines?: PendingRedlines,
): ParagraphMeasure {
  watchFontLoads()
  const paragraph = effectiveParagraph(
    source,
    drafts,
    extraRuns[source.id] ?? [],
  )
  const cached = measured.get(paragraph)
  if (
    cached &&
    cached.styles === model.styles &&
    cached.numbering === model.numbering &&
    cached.changes === model.changes &&
    cached.stories === model.stories &&
    cached.pending === pendingRedlines
  ) {
    return cached.measure
  }
  const partName = paragraphPartName(model, source)
  const projection = inlineChanges(
    paragraph,
    model.changes,
    partName,
    pendingParagraphChanges(pendingRedlines, paragraph.id, partName),
  )
  const face = paragraphFace(paragraph, model.styles)
  const linePx = paragraphLineHeightPx(face)
  const list = paragraphListIndent(paragraph, model)
  const measure: ParagraphMeasure = {
    paragraph,
    text: projection.text,
    projection,
    face,
    linePx,
    fontSize: face.run.fontSizePx ?? linePx,
    indent:
      (list?.leftPx ?? face.indentLeftPx ?? 0) + (face.indentRightPx ?? 0),
    textIndentPx: firstLineIndentPx(face, Boolean(list)),
    imagePx: Math.max(
      0,
      ...paragraphInlineXml(paragraph).map((xml) => drawingScene(xml).heightPx),
    ),
    pageBreaks: storedPageBreakOffsets(paragraph),
    anchors: paragraphAnchors(paragraph),
    lineCounts: new Map(),
    metrics: new Map(),
  }
  measured.set(paragraph, {
    styles: model.styles,
    numbering: model.numbering,
    changes: model.changes,
    stories: model.stories,
    pending: pendingRedlines,
    measure,
  })
  return measure
}

export function paragraphMetrics(
  source: DocumentParagraphWire,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  columnWidthPx: number,
  pendingRedlines?: PendingRedlines,
): ParagraphMetrics {
  const measure = paragraphMeasure(
    source,
    model,
    drafts,
    extraRuns,
    pendingRedlines,
  )
  const widthPx = Math.max(1, columnWidthPx - measure.indent)
  const cached = measure.metrics.get(widthPx)
  if (cached) return cached
  const lineCount = paragraphLineCount(
    measure,
    widthPx,
    0,
    measure.textIndentPx,
  )
  const metrics: ParagraphMetrics = {
    linePx: measure.linePx,
    lineCount,
    heightPx:
      (measure.face.marginTopPx ?? 0) +
      lineCount * measure.linePx +
      (measure.face.marginBottomPx ?? 0),
    keepNext: measure.face.keepNext === true,
    keepLines: measure.face.keepLines === true,
    widowControl: measure.face.widowControl !== false,
  }
  measure.metrics.set(widthPx, metrics)
  return metrics
}

export function paragraphLineCount(
  measure: ParagraphMeasure,
  widthPx: number,
  offset = 0,
  textIndentPx = 0,
): number {
  const key = `${offset}\u0000${widthPx}\u0000${textIndentPx}`
  const cached = measure.lineCounts.get(key)
  if (cached !== undefined) return cached
  const count = countLines(
    measure.text.slice(offset),
    measure.fontSize,
    widthPx,
    measure.face.run.fontFamily,
    textIndentPx,
  )
  if (measure.lineCounts.size >= MAX_LINE_COUNTS) measure.lineCounts.clear()
  measure.lineCounts.set(key, count)
  return count
}

export function paragraphFloatTargets(
  paragraph: DocumentParagraphWire,
): ParagraphFloatTargets {
  const cached = floatTargets.get(paragraph)
  if (cached) return cached
  const boxed: string[] = []
  let host = false
  for (const anchor of paragraphAnchors(paragraph)) {
    host = true
    boxed.push(...anchor.spec.textBoxParaIds)
  }
  const value = { host, boxed }
  floatTargets.set(paragraph, value)
  return value
}

function paragraphAnchors(paragraph: DocumentParagraphWire): ParagraphAnchor[] {
  const anchors: ParagraphAnchor[] = []
  for (const xml of paragraphAnchorXml(paragraph)) {
    const spec = drawingFloat(xml, paragraph.id)
    if (spec) anchors.push({ xml, spec })
  }
  return anchors
}

function storedPageBreakOffsets(paragraph: DocumentParagraphWire): number[] {
  const offsets: number[] = []
  const paragraphXml = paragraph.preservedXmlFragments.join('')
  if (pageBreakBefore(paragraphXml) || hasPageBreakElement(paragraphXml)) {
    offsets.push(0)
  }
  let cursor = 0
  for (const run of paragraph.runs) {
    if (hasPageBreakElement(run.preservedXmlFragments.join(''))) {
      offsets.push(cursor)
    }
    cursor += run.text.length
  }
  return offsets
}

function hasPageBreakElement(xml: string): boolean {
  return /<w:br\b[^>]*w:type="page"/i.test(xml)
}

function pageBreakBefore(xml: string): boolean {
  const before = xml.match(/<w:pageBreakBefore\b([^>]*)\/?>/i)
  if (!before) return false
  const val = before[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return val !== 'false' && val !== '0' && val !== 'off'
}
