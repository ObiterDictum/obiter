import {
  DocumentExtractionError,
  MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH,
  MAX_PDF_PAGE_COUNT,
  MINIMUM_PDF_CHARS_PER_PAGE,
  SCANNED_PDF_MESSAGE,
} from './document-extraction-limits'
import {
  collapsePdfGlyphSpacingWithLayout,
  layoutFromLaidChars,
  type ExtractedDocumentContent,
  type LaidChar,
} from './document-layout'
import {
  laidCharsFromOperatorList,
  withLineBreaks,
  withSemanticSpaces,
  type FontStyles,
  type PdfOps,
} from './pdf-glyph-layout'
import { getDocumentProxy } from 'unpdf'
import { documentTextLayoutSchema } from '@obiter/contracts'

interface PdfFont {
  isType3Font?: boolean
}
export async function extractPdfContent(
  buffer: Buffer,
): Promise<ExtractedDocumentContent> {
  // Copy before handing bytes to PDF.js — getDocumentProxy may transfer/
  // detach the ArrayBuffer, which would break later writes of the original.
  const bytes = Uint8Array.from(buffer)
  const pdf = await getDocumentProxy(bytes)
  try {
    if (pdf.numPages > MAX_PDF_PAGE_COUNT)
      throw new DocumentExtractionError(
        `PDF documents may contain at most ${MAX_PDF_PAGE_COUNT} pages.`,
        true,
      )

    const pages: Array<{ width: number; height: number }> = []
    const chars: LaidChar[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      pages.push({ width: viewport.width, height: viewport.height })
      const pageIndex = pageNumber - 1
      // getTextContent still supplies the font ascent/descent ratios, keyed by
      // the same loaded name the operator list reports for setFont.
      const content = await page.getTextContent()

      const exact = await exactPageChars(
        page,
        pageIndex,
        content.styles,
        textContentNeedsBidi(content.items),
      )
      if (exact.length > 0) {
        chars.push(...exact)
        const last = exact.at(-1)
        if (pageNumber < pdf.numPages && last) pushPageBreak(chars, last)
        assertWithinLength(chars)
        continue
      }

      // No glyph-path text on this page (Type 3 fonts, unusual generators):
      // fall back to interpolated item geometry rather than losing content.
      let lastY = 0
      let lastX = 0
      let lastHeight = 12
      let lastAscent = 10
      let lastDescent = 2
      let lastBaselineX = 1
      let lastBaselineY = 0
      for (const item of content.items) {
        if ('str' in item) {
          pushPdfItemChars(chars, item, pageIndex, content.styles)
          if (item.transform) {
            lastX = item.transform[4] ?? lastX
            lastY = item.transform[5] ?? lastY
          }
          const metrics = pdfItemMetrics(item, content.styles)
          const direction = pdfItemBaseline(item)
          lastHeight = metrics.fontSize
          lastAscent = metrics.ascent
          lastDescent = metrics.descent
          lastBaselineX = direction.x
          lastBaselineY = direction.y
        }
        if ('hasEOL' in item && item.hasEOL) {
          chars.push({
            ch: '\n',
            pageIndex,
            x: lastX,
            y: lastY,
            width: 0,
            height: lastHeight,
            ascent: lastAscent,
            descent: lastDescent,
            baselineX: lastBaselineX,
            baselineY: lastBaselineY,
          })
        }
      }
      if (pageNumber < pdf.numPages) {
        pushPageBreak(chars, {
          ch: '\n',
          pageIndex,
          x: lastX,
          y: lastY,
          width: 0,
          height: lastHeight,
          ascent: lastAscent,
          descent: lastDescent,
          baselineX: lastBaselineX,
          baselineY: lastBaselineY,
        })
      }
      assertWithinLength(chars)
    }

    const normalised = collapsePdfGlyphSpacingWithLayout(chars)
    const trimmed = prepareLaidChars(normalised)
    const text = trimmed.map((item) => item.ch).join('')
    const characters = text.replaceAll(/[\s\p{Cf}]/gu, '').length

    if (
      characters === 0 ||
      (pages.length > 1 &&
        characters < pages.length * MINIMUM_PDF_CHARS_PER_PAGE)
    )
      throw new DocumentExtractionError(SCANNED_PDF_MESSAGE, true)

    const layout = documentTextLayoutSchema.safeParse(
      layoutFromLaidChars(trimmed, pages),
    )
    if (!layout.success)
      throw new DocumentExtractionError(
        'This PDF uses text geometry that cannot be redacted safely.',
        true,
      )

    return { text, layout: layout.data }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
}

/** Two newlines separate pages, anchored on the last glyph drawn. */
function pushPageBreak(chars: LaidChar[], anchor: LaidChar) {
  const separator: LaidChar = { ...anchor, ch: '\n', width: 0 }
  chars.push({ ...separator }, { ...separator })
}

function assertWithinLength(chars: LaidChar[]) {
  if (chars.length > MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH)
    throw new DocumentExtractionError(
      `Extracted text must be at most ${MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH} characters.`,
      true,
    )
}

/**
 * Per-glyph geometry replayed from the page's content stream. Returns an empty
 * array when the operator list is unavailable or draws no glyph-path text.
 */
async function exactPageChars(
  page: {
    getOperatorList?: () => Promise<{
      fnArray: number[] | Int32Array
      argsArray: unknown[]
    }>
    commonObjs?: {
      has: (id: string) => boolean
      get: (id: string) => PdfFont | undefined
    }
  },
  pageIndex: number,
  styles: FontStyles | undefined,
  needsBidi: boolean,
): Promise<LaidChar[]> {
  if (typeof page.getOperatorList !== 'function') return []
  const ops = await loadPdfOps()
  if (!ops) return []
  try {
    const operatorList = await page.getOperatorList()
    if (
      Object.values(styles ?? {}).some((style) => style?.vertical === true) ||
      operatorListHasVerticalGlyphs(operatorList)
    )
      throw new DocumentExtractionError(
        'This PDF uses vertical text geometry that cannot be redacted safely.',
        true,
      )
    if (needsBidi) {
      console.warn('PDF exact glyph geometry fallback', {
        pageNumber: pageIndex + 1,
        reason: 'bidi_text',
      })
      return []
    }
    if (operatorListUsesType3Font(operatorList, ops, page.commonObjs)) {
      console.warn('PDF exact glyph geometry fallback', {
        pageNumber: pageIndex + 1,
        reason: 'type3_font',
      })
      return []
    }
    const chars = laidCharsFromOperatorList({
      operatorList,
      ops,
      pageIndex,
      styles,
    })
    if (chars.some((char) => char.skewed))
      throw new DocumentExtractionError(
        'This PDF uses skewed text geometry that cannot be redacted safely.',
        true,
      )
    return chars.length > 0 ? withSemanticSpaces(withLineBreaks(chars)) : []
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error
    console.warn('PDF exact glyph geometry fallback', {
      pageNumber: pageIndex + 1,
      reason: 'operator_replay_failed',
    })
    return []
  }
}

const STRONG_RTL_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u

function textContentNeedsBidi(items: unknown[]) {
  return items.some((item) => {
    if (typeof item !== 'object' || item === null || !('str' in item))
      return false
    const text = typeof item.str === 'string' ? item.str : ''
    return ('dir' in item && item.dir === 'rtl') || STRONG_RTL_SCRIPT.test(text)
  })
}

function operatorListHasVerticalGlyphs(operatorList: { argsArray: unknown[] }) {
  const hasVerticalMetric = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(hasVerticalMetric)
    return (
      typeof value === 'object' &&
      value !== null &&
      'vmetric' in value &&
      value.vmetric !== undefined
    )
  }
  return operatorList.argsArray.some(hasVerticalMetric)
}

function operatorListUsesType3Font(
  operatorList: { fnArray: number[] | Int32Array; argsArray: unknown[] },
  ops: PdfOps,
  commonObjs:
    | { has: (id: string) => boolean; get: (id: string) => PdfFont | undefined }
    | undefined,
) {
  if (!commonObjs) return false
  const isType3 = (fontName: unknown) => {
    if (typeof fontName !== 'string' || !commonObjs.has(fontName)) return false
    const font = commonObjs.get(fontName)
    return (
      typeof font === 'object' &&
      font !== null &&
      'isType3Font' in font &&
      font.isType3Font === true
    )
  }
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const rawArgs: unknown = operatorList.argsArray[index]
    const args: unknown[] | undefined = Array.isArray(rawArgs)
      ? rawArgs
      : undefined
    if (operatorList.fnArray[index] === ops.setFont) {
      if (isType3(args?.[0])) return true
      continue
    }
    // A font can also arrive through setGState's /Font entry, and that reaches
    // the renderer's setFont path too. Type 3 has to be screened on both, or a
    // font set only through the graphics state would be replayed instead of
    // rejected even though the glyph replay cannot read its metrics.
    if (operatorList.fnArray[index] !== ops.setGState) continue
    const gstate: unknown = args?.[0]
    if (!Array.isArray(gstate)) continue
    for (const rawEntry of gstate) {
      const entry: unknown = rawEntry
      if (
        Array.isArray(entry) &&
        entry[0] === 'Font' &&
        Array.isArray(entry[1])
      ) {
        if (isType3(entry[1][0])) return true
      }
    }
  }
  return false
}

let cachedOps: PdfOps | null | undefined

/** unpdf re-exports the pdf.js `OPS` enum from its bundled build. */
async function loadPdfOps(): Promise<PdfOps | null> {
  if (cachedOps !== undefined) return cachedOps
  try {
    // SAFETY: unpdf re-exports the pdf.js OPS enum from its bundled build without types; only
    // the optional OPS member is read, and a missing enum yields null exactly as a failed import.
    const module = (await import('unpdf/pdfjs')) as {
      OPS?: PdfOps
    }
    cachedOps = module.OPS ?? null
  } catch {
    cachedOps = null
  }
  return cachedOps
}

function pdfItemMetrics(
  item: {
    transform?: number[]
    height?: number
    fontName?: string
  },
  styles: Record<string, { ascent?: number; descent?: number }> | undefined,
) {
  const transform = item.transform ?? []
  const fromTransform = Math.hypot(transform[2] ?? 0, transform[3] ?? 0)
  const fromHeight =
    typeof item.height === 'number' && item.height > 0 ? item.height : 0
  const fontSize = Math.max(fromTransform, fromHeight) || 12
  const style = item.fontName && styles ? styles[item.fontName] : undefined
  const ascentRatio =
    typeof style?.ascent === 'number' &&
    Number.isFinite(style.ascent) &&
    style.ascent > 0
      ? style.ascent
      : 0.8
  const descentRatio =
    typeof style?.descent === 'number' && Number.isFinite(style.descent)
      ? Math.abs(style.descent)
      : 0.2
  return {
    fontSize,
    ascent: fontSize * ascentRatio,
    descent: fontSize * descentRatio,
  }
}

function pdfItemBaseline(item: { transform?: number[] }) {
  const transform = item.transform ?? []
  const magnitude = Math.hypot(transform[0] ?? 1, transform[1] ?? 0) || 1
  return {
    x: (transform[0] ?? 1) / magnitude,
    y: (transform[1] ?? 0) / magnitude,
  }
}

/**
 * Interpolated item covers extend perpendicular to the baseline, so skewed
 * glyph axes must fail closed here exactly as they do in operator replay.
 */
function assertItemAxesPerpendicular(transform: number[]) {
  const alongMagnitude = Math.hypot(transform[0] ?? 1, transform[1] ?? 0) || 1
  const acrossMagnitude = Math.hypot(transform[2] ?? 0, transform[3] ?? 1) || 1
  const alignment =
    ((transform[0] ?? 1) * (transform[2] ?? 0) +
      (transform[1] ?? 0) * (transform[3] ?? 1)) /
    (alongMagnitude * acrossMagnitude)
  if (Math.abs(alignment) > 0.01)
    throw new DocumentExtractionError(
      'This PDF uses skewed text geometry that cannot be redacted safely.',
      true,
    )
}

function pushPdfItemChars(
  chars: LaidChar[],
  item: {
    str?: string
    transform?: number[]
    width?: number
    height?: number
    fontName?: string
  },
  pageIndex: number,
  styles: Record<string, { ascent?: number; descent?: number }> | undefined,
) {
  const value = item.str ?? ''
  if (!value) return
  const transform = item.transform ?? []
  assertItemAxesPerpendicular(transform)
  const originX = transform[4] ?? 0
  const originY = transform[5] ?? 0
  const { fontSize, ascent, descent } = pdfItemMetrics(item, styles)
  const width = typeof item.width === 'number' ? item.width : 0
  const glyphs = [...value]
  const glyphWidth = glyphs.length > 0 ? width / glyphs.length : 0
  const baseline = pdfItemBaseline(item)
  glyphs.forEach((ch, index) => {
    chars.push({
      ch,
      pageIndex,
      x: originX + index * glyphWidth * baseline.x,
      y: originY + index * glyphWidth * baseline.y,
      width: Math.max(glyphWidth, 0.5),
      height: fontSize,
      ascent,
      descent,
      baselineX: baseline.x,
      baselineY: baseline.y,
    })
  })
}

/**
 * Drop format controls and normalise CR before text/layout are derived so
 * heuristic patterns see the same offsets as stored layout segments.
 */
export function prepareLaidChars(chars: LaidChar[]): LaidChar[] {
  const stripped: LaidChar[] = []
  for (let index = 0; index < chars.length; index += 1) {
    const item = chars[index]!
    if (/\p{Cf}/u.test(item.ch)) continue
    if (item.ch === '\r') {
      // Match the old page-text normaliser: \r\n? → \n.
      if (chars[index + 1]?.ch === '\n') continue
      stripped.push({ ...item, ch: '\n' })
      continue
    }
    stripped.push(item)
  }
  return trimLaidChars(stripped)
}

function trimLaidChars(chars: LaidChar[]) {
  let start = 0
  let end = chars.length
  while (start < end && /\s/u.test(chars[start]!.ch)) start += 1
  while (end > start && /\s/u.test(chars[end - 1]!.ch)) end -= 1
  const sliced = chars.slice(start, end)
  const compact: LaidChar[] = []
  let newlineRun = 0
  for (const item of sliced) {
    if (item.ch === '\n') {
      newlineRun += 1
      if (newlineRun <= 2) compact.push(item)
      continue
    }
    newlineRun = 0
    compact.push(item)
  }
  return compact
}
