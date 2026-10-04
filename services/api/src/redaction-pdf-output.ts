import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { documentTextLayoutSchema } from '@obiter/contracts'
import { PDFDocument } from 'pdf-lib'
import { createIsomorphicCanvasFactory, getDocumentProxy } from 'unpdf'
import {
  coalesceRedactionRegions,
  coverRectsForSpan,
  glyphCoverRect,
  snapDeviceCoverOutward,
} from '@obiter/redaction-policy'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import type { DocumentTextLayout } from './document-layout'

export interface RedactedPdfInput {
  pdfBytes: Buffer
  layout: DocumentTextLayout
  /** Extracted source text the span offsets address; drives region coalescing. */
  text: string
  spans: RedactionSpan[]
  decisions: Decisions
}

interface PageRect {
  x: number
  y: number
  width: number
  height: number
  /** Characters covered by this rect — drives descender/ascent padding. */
  ink?: string
  /** Spans this rect redacts, so an off-page cover is refused by every id. */
  spanIds: string[]
}

/** Visible page box in PDF user space, origin included. */
interface PageBounds {
  x: number
  y: number
  width: number
  height: number
}

function pageBoundsOf(view: number[] | undefined): PageBounds {
  const [x = 0, y = 0, x2 = 0, y2 = 0] = Array.isArray(view) ? view : []
  return {
    x,
    y,
    width: Math.max((x2 ?? 0) - (x ?? 0), 0),
    height: Math.max((y2 ?? 0) - (y ?? 0), 0),
  }
}

/** Render scale for burned-in output. Higher = sharper, larger files. */
const RENDER_SCALE = 2

/**
 * Ceilings on one rasterized page. A4 at RENDER_SCALE is about 2 megapixels;
 * these allow a large-format page while refusing a hostile /MediaBox that would
 * otherwise allocate gigabytes before validateSecurePdf could run.
 */
const MAX_RASTER_DIMENSION_PX = 10_000
const MAX_RASTER_PIXELS = 40_000_000

/**
 * Thrown when a page is too large to rasterize safely. The finalize path maps
 * this to a visible secure-PDF failure instead of attempting the allocation.
 */
export class RedactionRasterLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedactionRasterLimitError'
  }
}

/**
 * Thrown when an output-affecting span has no cover geometry. Finalize catches
 * this and falls back to text output; the message names span ids for diagnosis
 * but must not be logged verbatim (see redaction_burn_failed in redact-review).
 */
export class RedactionCoverGeometryError extends Error {
  readonly spanIds: string[]

  constructor(spanIds: string[]) {
    super(`Redaction cover geometry missing for span(s): ${spanIds.join(', ')}`)
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
  // Layout-only failure first: an accepted span with no geometry must refuse
  // before the source is even parsed, so stored invalid geometry reports the
  // same reason regardless of the source bytes.
  const rectsByPage = collectRedactionRects(input)
  return rasterizePdf(
    input.pdfBytes,
    // Backstop before any rendering: a cover that misses the page paints
    // nothing, so the span would publish its source ink intact. Bounds come
    // from the page itself, not the stored layout, which carries no origin.
    async (source) => {
      const pageBounds: PageBounds[] = []
      for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
        const page = await source.getPage(pageNumber)
        pageBounds.push(pageBoundsOf(page.view))
      }
      assertCoversOnPage(rectsByPage, pageBounds)
    },
    ({ context, viewport, pageIndex }) => {
      for (const rect of rectsByPage.get(pageIndex) ?? [])
        paintRedaction(context, viewport, rect)
    },
  )
}

export interface RasterizePaintContext {
  context: SKRSContext2D
  viewport: {
    convertToViewportRectangle: (rect: number[]) => number[]
    width: number
    height: number
  }
  pageIndex: number
  pageNumber: number
}

/**
 * Rasterize every page of a PDF into a new image-only PDF: each output page is
 * a single embedded PNG with no fonts, annotations, forms or text operators.
 * `paint` may draw marks into the rendered pixels before they are embedded.
 * `onOpened` runs after the source parses and before the first page renders,
 * so a caller can refuse before any work is done.
 */
export async function rasterizePdf(
  pdfBytes: Buffer,
  onOpened:
    | ((source: Awaited<ReturnType<typeof getDocumentProxy>>) => Promise<void>)
    | undefined,
  paint?: (context: RasterizePaintContext) => void,
): Promise<Uint8Array> {
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const source = await getDocumentProxy(Uint8Array.from(pdfBytes), {
    CanvasFactory,
  })
  const output = await PDFDocument.create()

  try {
    if (onOpened) await onOpened(source)

    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      // Refuse before allocating. validateSecurePdf runs only after the whole
      // PDF is built, so without this guard a hostile /MediaBox becomes a
      // multi-gigabyte canvas and can take the API process down.
      if (
        width > MAX_RASTER_DIMENSION_PX ||
        height > MAX_RASTER_DIMENSION_PX ||
        width * height > MAX_RASTER_PIXELS
      )
        throw new RedactionRasterLimitError(
          'A page in the document is too large to rasterize.',
        )
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      // SAFETY: the canvas comes from @napi-rs/canvas, the implementation handed to
      // createIsomorphicCanvasFactory above, so its context satisfies unpdf's render surface;
      // the never-casts bridge the two libraries' nominal typings only.
      await page.render({
        canvasContext: context as never,
        viewport,
        canvas: canvas as never,
      }).promise

      paint?.({
        context,
        viewport,
        pageIndex: pageNumber - 1,
        pageNumber,
      })

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
  const snapped = snapDeviceCoverOutward({
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  })
  const left = snapped.left
  const top = snapped.top
  const width = Math.max(snapped.right - snapped.left, 1)
  const height = Math.max(snapped.bottom - snapped.top, 1)
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
  // A cover that is not fully opaque black has failed to conceal the glyphs
  // under it. Sample it before publishing rather than trusting globalAlpha.
  assertOpaqueBlackCover(context, {
    left: left - fringe,
    top: top - fringe,
    width: width + fringe * 2,
    height: height + fringe * 2,
    spanIds: rect.spanIds,
  })
  context.restore()
}

/** @deprecated Prefer glyphCoverRect / coverRectsForSpan. */
export function padGlyphRect(
  rect: Omit<PageRect, 'spanIds'>,
): Omit<PageRect, 'spanIds'> {
  const covered = glyphCoverRect({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    fontSize: rect.height,
    ink: rect.ink,
  })
  return { ...rect, ...covered }
}

interface RectPlan {
  spanIds: string[]
  start: number
  end: number
}

function collectRedactionRects(input: RedactedPdfInput) {
  const rectsByPage = new Map<number, PageRect[]>()
  const missingSpanIds: string[] = []
  // One bar per coalesced accepted region. Pseudonymised output never reaches
  // this rasterizer: it stays an editable token copy (DOCX or text).
  const plans: RectPlan[] = coalesceRedactionRegions(
    input.text,
    input.spans,
    input.decisions,
  ).map((region) => ({
    spanIds: region.spanIds,
    start: region.start,
    end: region.end,
  }))
  for (const plan of plans) {
    const coveredRects = coverRectsForSpan({
      segments: input.layout.segments,
      spanStart: plan.start,
      spanEnd: plan.end,
      spanText: input.text.slice(plan.start, plan.end),
      mergeWhitespace: true,
    })
    if (coveredRects.length === 0) {
      missingSpanIds.push(...plan.spanIds)
      continue
    }
    for (const covered of coveredRects) {
      const list = rectsByPage.get(covered.pageIndex) ?? []
      list.push({
        x: covered.x,
        y: covered.y,
        width: covered.width,
        height: covered.height,
        ink: covered.ink,
        spanIds: plan.spanIds,
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

/**
 * Backstop for the replay: a cover that does not intersect its page paints
 * nothing, so the span would be published with its source ink intact. Refuse
 * it exactly as for a span with no rects at all.
 */
function assertCoversOnPage(
  rectsByPage: Map<number, PageRect[]>,
  pageBounds: PageBounds[],
) {
  const missing = new Set<string>()
  for (const [pageIndex, rects] of rectsByPage) {
    for (const rect of rects) {
      if (coverMissesPage(rect, pageBounds[pageIndex]))
        for (const spanId of rect.spanIds) missing.add(spanId)
    }
  }
  if (missing.size > 0) throw new RedactionCoverGeometryError([...missing])
}

/** Whether a cover lies entirely outside the page box. */
function coverMissesPage(rect: PageRect, page: PageBounds | undefined) {
  if (!page || page.width <= 0 || page.height <= 0) return true
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  )
    return true
  return (
    rect.x >= page.x + page.width ||
    rect.x + rect.width <= page.x ||
    rect.y >= page.y + page.height ||
    rect.y + rect.height <= page.y
  )
}

/** RENDER_SCALE is above; the opacity check runs in device pixels. */
function assertOpaqueBlackCover(
  context: SKRSContext2D,
  cover: {
    left: number
    top: number
    width: number
    height: number
    spanIds: string[]
  },
) {
  const x = Math.round(cover.left + cover.width / 2)
  const y = Math.round(cover.top + cover.height / 2)
  // SAFETY: the context is @napi-rs/canvas, whose getImageData returns a
  // Uint8ClampedArray of RGBA for the 1x1 region requested.
  const sample = context.getImageData(x, y, 1, 1).data
  const [red = 0, green = 0, blue = 0, alpha = 0] = sample
  if (alpha !== 255 || red > 8 || green > 8 || blue > 8)
    throw new RedactionCoverGeometryError(cover.spanIds)
}

export function redactedPdfFilename(sourceFilename: string) {
  const trimmed = sourceFilename.trim() || 'document.pdf'
  // A DOCX or text source becomes a PDF here, so the container extension is
  // replaced rather than appended (matching redactedTextFilename).
  const stem = trimmed.replace(/\.[^.]+$/u, '') || trimmed
  return `${stem}-redacted.pdf`
}

export function redactedTextFilename(sourceFilename: string) {
  const trimmed = sourceFilename.trim() || 'document'
  const stem = trimmed.replace(/\.[^.]+$/u, '') || trimmed
  return `${stem}-redacted.txt`
}

export function isDocumentTextLayout(
  value: unknown,
): value is DocumentTextLayout {
  return documentTextLayoutSchema.safeParse(value).success
}

export function isPdfMimeOrFilename(
  filename: string,
  mimeType: string | null | undefined,
) {
  if (mimeType?.toLowerCase().includes('pdf')) return true
  return /\.pdf$/i.test(filename)
}
