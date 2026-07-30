import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import {
  createIsomorphicCanvasFactory,
  getDocumentProxy,
} from 'unpdf'
import {
  affectsOutput,
  coverRectsForSpan,
  glyphCoverRect,
  type TokenMap,
} from '@obiter/redaction-policy'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import type { DocumentTextLayout } from './document-layout'

export interface RedactedPdfInput {
  pdfBytes: Buffer
  layout: DocumentTextLayout
  spans: RedactionSpan[]
  decisions: Decisions
  outputMode: 'redacted' | 'pseudonymised'
  tokenMap: TokenMap
}

interface PageRect {
  x: number
  y: number
  width: number
  height: number
  label?: string
  /** Characters covered by this rect — drives descender/ascent padding. */
  ink?: string
}

/** Render scale for burned-in output. Higher = sharper, larger files. */
const RENDER_SCALE = 2

/**
 * Thrown when an output-affecting span has no cover geometry. Finalize catches
 * this and falls back to text output; the message names span ids for diagnosis
 * but must not be logged verbatim (see redaction_pdf_burn_failed).
 */
export class RedactionCoverGeometryError extends Error {
  readonly spanIds: string[]

  constructor(spanIds: string[]) {
    super(
      `Redaction cover geometry missing for span(s): ${spanIds.join(', ')}`,
    )
    this.name = 'RedactionCoverGeometryError'
    this.spanIds = spanIds
  }
}

/**
 * Build a redacted PDF by rasterizing each page with redaction marks burned
 * into the pixels. The output has no selectable text layer, so covered
 * content cannot be copied or recovered via text extraction.
 */
export async function buildRedactedPdf(
  input: RedactedPdfInput,
): Promise<Uint8Array> {
  const rectsByPage = collectRedactionRects(input)
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const source = await getDocumentProxy(Uint8Array.from(input.pdfBytes), {
    CanvasFactory,
  })
  const output = await PDFDocument.create()

  try {
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      await page.render({
        canvasContext: context as never,
        viewport,
        canvas: canvas as never,
      }).promise

      const pageIndex = pageNumber - 1
      for (const rect of mergeRects(rectsByPage.get(pageIndex) ?? [])) {
        paintRedaction(context, viewport, rect)
      }

      const image = await output.embedPng(canvas.toBuffer('image/png'))
      const pageWidth = viewport.width / RENDER_SCALE
      const pageHeight = viewport.height / RENDER_SCALE
      const outPage = output.addPage([pageWidth, pageHeight])
      outPage.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      })
    }
  } finally {
    await source.destroy()
  }

  return output.save()
}

function paintRedaction(
  context: SKRSContext2D,
  viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
  rect: PageRect,
) {
  // `rect` is already a glyph-cover / union box in PDF user space.
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height,
  ])
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.max(Math.abs(x2 - x1), 1)
  const height = Math.max(Math.abs(y2 - y1), 1)
  const fringe = 1

  // pdf.js leaves transforms / alpha on the context after render; reset so
  // marks are fully opaque and aligned to viewport pixel space.
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.fillStyle = '#000000'
  context.fillRect(
    left - fringe,
    top - fringe,
    width + fringe * 2,
    height + fringe * 2,
  )

  if (rect.label) {
    const fontSize = Math.min(height * 0.55, 22)
    if (fontSize >= 6) {
      context.fillStyle = '#ffffff'
      context.font = `bold ${fontSize}px sans-serif`
      const textWidth = context.measureText(rect.label).width
      if (textWidth + 4 < width) {
        context.fillText(
          rect.label,
          left + 2,
          top + height / 2 + fontSize * 0.35,
        )
      }
    }
  }
  context.restore()
}

/** @deprecated Prefer glyphCoverRect / coverRectsForSpan. */
export function padGlyphRect(rect: PageRect): PageRect {
  const covered = glyphCoverRect({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    fontSize: rect.height,
    ink: rect.ink,
  })
  return { ...rect, ...covered }
}

function collectRedactionRects(input: RedactedPdfInput) {
  const rectsByPage = new Map<number, PageRect[]>()
  const missingSpanIds: string[] = []
  for (const span of input.spans) {
    if (!affectsOutput(input.decisions[span.id])) continue
    const label =
      input.outputMode === 'pseudonymised'
        ? (input.tokenMap[span.id] ?? '[REDACTED]')
        : undefined
    const coveredRects = coverRectsForSpan({
      segments: input.layout.segments,
      spanStart: span.start,
      spanEnd: span.end,
      spanText: span.text,
    })
    if (coveredRects.length === 0) {
      missingSpanIds.push(span.id)
      continue
    }
    for (const covered of coveredRects) {
      const list = rectsByPage.get(covered.pageIndex) ?? []
      list.push({
        x: covered.x,
        y: covered.y,
        width: covered.width,
        height: covered.height,
        label,
        ink: covered.ink,
      })
      rectsByPage.set(covered.pageIndex, list)
    }
  }
  // Fail closed: an accepted span with no cover would publish unredacted pixels
  // while the audit trail still records a successful redaction.
  if (missingSpanIds.length > 0) {
    throw new RedactionCoverGeometryError(missingSpanIds)
  }
  return rectsByPage
}

function mergeRects(rects: PageRect[]): PageRect[] {
  // coverRectsForSpan already union-merges per span; keep separate span bars.
  return rects
}

export function redactedPdfFilename(sourceFilename: string) {
  const trimmed = sourceFilename.trim() || 'document.pdf'
  if (/\.pdf$/i.test(trimmed)) {
    return trimmed.replace(/\.pdf$/i, '-redacted.pdf')
  }
  return `${trimmed}-redacted.pdf`
}

export function redactedTextFilename(sourceFilename: string) {
  const trimmed = sourceFilename.trim() || 'document'
  const stem = trimmed.replace(/\.[^.]+$/u, '') || trimmed
  return `${stem}-redacted.txt`
}

export function isDocumentTextLayout(value: unknown): value is DocumentTextLayout {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    Array.isArray(record.pages) &&
    Array.isArray(record.segments)
  )
}

export function isPdfMimeOrFilename(
  filename: string,
  mimeType: string | null | undefined,
) {
  if (mimeType?.toLowerCase().includes('pdf')) return true
  return /\.pdf$/i.test(filename)
}
