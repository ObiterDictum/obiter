import { createCanvas } from '@napi-rs/canvas'
import { documentTextLayoutSchema } from '@obiter/contracts'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  applyRedacted,
  coverRectsForSpan,
  snapDeviceCoverOutward,
  supplementSpans,
} from '@obiter/redaction-policy'
import {
  createIsomorphicCanvasFactory,
  extractText,
  getDocumentProxy,
} from 'unpdf'
import { describe, expect, it, vi } from 'vitest'
import { extractDocumentContent, prepareLaidChars } from './document-extraction'
import type { DocumentTextLayout } from './document-layout'
import { buildRedactedPdf } from './redaction-pdf-output'
import { findUncoveredPdfRegions } from './extraction-coverage'
import {
  rawFormPdf,
  rawFreeTextPdf,
  rawRtlPdf,
  rawType1Pdf,
  rawType3Pdf,
  rawVerticalPdf,
  textFieldPdf,
} from './pdf-glyph-fixtures.test-helper'
import {
  collapsePdfGlyphSpacingWithLayout,
  type LaidChar,
} from './document-layout'

const SIZE = 11
const START_X = 60
const BASELINE = 700

/**
 * `drawText` emits no kerning, so the drawn position of each character is the
 * running sum of individual glyph advances. `widthOfTextAtSize` over a whole
 * string applies kern pairs and would overstate it.
 */
function drawnAdvance(
  font: { widthOfTextAtSize: (s: string, n: number) => number },
  text: string,
) {
  return [...text].reduce(
    (total, ch) => total + font.widthOfTextAtSize(ch, SIZE),
    0,
  )
}

async function singleLinePdf(line: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const page = doc.addPage([595, 842])
  page.drawText(line, { x: START_X, y: BASELINE, size: SIZE, font })
  return { bytes: Buffer.from(await doc.save()), font }
}

async function itemPathText(bytes: Buffer) {
  const pdf = await getDocumentProxy(Uint8Array.from(bytes))
  try {
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    const chars: LaidChar[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      for (const ch of item.str) {
        chars.push({
          ch,
          pageIndex: 0,
          x: 0,
          y: 0,
          width: 1,
          height: 12,
          ascent: 10,
          descent: 2,
          baselineX: 1,
          baselineY: 0,
        })
      }
      if (item.hasEOL) {
        const anchor = chars.at(-1)
        chars.push({
          ch: '\n',
          pageIndex: 0,
          x: anchor?.x ?? 0,
          y: anchor?.y ?? 0,
          width: 0,
          height: anchor?.height ?? 12,
          ascent: anchor?.ascent ?? 10,
          descent: anchor?.descent ?? 2,
          baselineX: anchor?.baselineX ?? 1,
          baselineY: anchor?.baselineY ?? 0,
        })
      }
    }
    return prepareLaidChars(collapsePdfGlyphSpacingWithLayout(chars))
      .map((char) => char.ch)
      .join('')
  } finally {
    await pdf.destroy()
  }
}

/**
 * Rasterise a page and return the ink bounding box. Callers assert that a
 * redaction cover contains this box with no slack: a short cover publishes
 * part of a redacted glyph. Font mismatch (missing Liberation) moves the ink
 * by fractions of a point; that is a CI install defect, not a looser bound.
 */
async function renderedInkBounds(bytes: Buffer) {
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const pdf = await getDocumentProxy(Uint8Array.from(bytes), { CanvasFactory })
  try {
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    await page.render({
      canvasContext: context as never,
      viewport,
      canvas: canvas as never,
    }).promise
    const pixels = context.getImageData(0, 0, width, height).data
    let left = width
    let right = -1
    let top = height
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        if (
          (pixels[offset] ?? 255) >= 128 &&
          (pixels[offset + 1] ?? 255) >= 128 &&
          (pixels[offset + 2] ?? 255) >= 128
        )
          continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    if (right < left || bottom < top) throw new Error('PDF rendered no ink.')
    return { left, right, top, bottom, viewport }
  } finally {
    await pdf.destroy()
  }
}

function coverBoundsInViewport(
  viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
  covers: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const rectangles = covers.map((cover) => {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] =
      viewport.convertToViewportRectangle([
        cover.x,
        cover.y,
        cover.x + cover.width,
        cover.y + cover.height,
      ])
    return {
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
      top: Math.min(y1, y2),
      bottom: Math.max(y1, y2),
    }
  })
  return snapDeviceCoverOutward({
    left: Math.min(...rectangles.map((rect) => rect.left)),
    right: Math.max(...rectangles.map((rect) => rect.right)),
    top: Math.min(...rectangles.map((rect) => rect.top)),
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
  })
}

describe('exact glyph geometry', () => {
  // Proportional text where the advances differ sharply: W and M are over three
  // times the width of i, l and a full stop, so any uniform assumption drifts.
  const LINE =
    'Ms Wilhelmina Ashcroft-Hargreaves of 14 St Aldgate Terrace, Oxford'

  it.each([['Wilhelmina'], ['Ashcroft-Hargreaves'], ['Oxford']])(
    'covers %s without leaving ink outside the bar',
    async (redact) => {
      const { bytes, font } = await singleLinePdf(LINE)
      const extracted = await extractDocumentContent('pdf', bytes)
      const layout = extracted.layout
      expect(layout).not.toBeNull()

      const trueLeft =
        START_X + drawnAdvance(font, LINE.slice(0, LINE.indexOf(redact)))
      const trueRight = trueLeft + drawnAdvance(font, redact)

      const spanStart = extracted.text.indexOf(redact)
      expect(spanStart).toBeGreaterThanOrEqual(0)
      const covers = coverRectsForSpan({
        segments: layout!.segments,
        spanStart,
        spanEnd: spanStart + redact.length,
        spanText: redact,
      })
      expect(covers).toHaveLength(1)
      const cover = covers[0]!

      // The bar must reach past the ink on both sides. Under-covering by any
      // amount publishes part of a redacted name.
      expect(cover.x).toBeLessThanOrEqual(trueLeft)
      expect(cover.x + cover.width).toBeGreaterThanOrEqual(trueRight)

      // And it must not swallow neighbouring words: the only slack is the
      // deliberate padding in glyphCoverRect, a twentieth of the font size.
      const padding = SIZE * 0.04
      expect(trueLeft - cover.x).toBeLessThanOrEqual(padding + 0.01)
      expect(cover.x + cover.width - trueRight).toBeLessThanOrEqual(
        padding + 0.01,
      )
    },
  )

  it('records one advance per character and merges the line into few runs', async () => {
    const { bytes } = await singleLinePdf(LINE)
    const extracted = await extractDocumentContent('pdf', bytes)
    const segments = extracted.layout!.segments

    // Contiguous text on one baseline is one run, not one segment per glyph.
    expect(segments.length).toBeLessThan(4)
    for (const segment of segments) {
      expect(segment.advances).toHaveLength(segment.end - segment.start)
    }
  })

  it('keeps text identical to the item-based extraction path', async () => {
    const { bytes } = await singleLinePdf(LINE)
    const extracted = await extractDocumentContent('pdf', bytes)
    expect(extracted.text).toBe(LINE)
  })

  it('places characters after a kerning adjustment at their drawn position', async () => {
    // TJ offsets shift text without an intervening glyph. The replay must apply
    // them, or everything after the adjustment is misplaced.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.TimesRoman)
    const page = doc.addPage([595, 842])
    page.drawText('AB', { x: START_X, y: BASELINE, size: SIZE, font })
    const shifted = START_X + drawnAdvance(font, 'AB') + 20
    page.drawText('CD', { x: shifted, y: BASELINE, size: SIZE, font })
    const bytes = Buffer.from(await doc.save())

    const extracted = await extractDocumentContent('pdf', bytes)
    const spanStart = extracted.text.indexOf('CD')
    const covers = coverRectsForSpan({
      segments: extracted.layout!.segments,
      spanStart,
      spanEnd: spanStart + 2,
      spanText: 'CD',
    })
    expect(covers[0]!.x).toBeCloseTo(shifted - SIZE * 0.04, 1)
  })

  it('recovers TJ positioning gaps as semantic spaces before detection', async () => {
    const bytes = rawType1Pdf(
      'BT /F1 12 Tf 1 0 0 1 60 700 Tm [(Contact) -278 (Alice) -278 (Brown) -278 (on) -278 (07700) -278 (900482)] TJ ET',
    )
    const extracted = await extractDocumentContent('pdf', bytes)

    expect(extracted.text).toBe('Contact Alice Brown on 07700 900482')
    expect(supplementSpans(extracted.text)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'phone',
          text: '07700 900482',
        }),
      ]),
    )
  })

  it('keeps semantic spaces between independently positioned columns', async () => {
    const bytes = rawType1Pdf(
      'BT /F1 12 Tf 1 0 0 1 60 700 Tm (Alice Brown) Tj ET BT /F1 12 Tf 1 0 0 1 130 700 Tm (01632) Tj ET BT /F1 12 Tf 1 0 0 1 168 700 Tm (960123) Tj ET',
    )

    await expect(extractDocumentContent('pdf', bytes)).resolves.toMatchObject({
      text: 'Alice Brown 01632 960123',
    })
  })

  it('matches the collapsed pdf.js item path across generated PDF layouts', async () => {
    const proportional = await singleLinePdf(LINE)
    const fixtures = [
      proportional.bytes,
      rawType1Pdf(
        'BT /F1 12 Tf 1 0 0 1 60 700 Tm [(Contact) -278 (Alice) -278 (Brown) -278 (on) -278 (07700) -278 (900482)] TJ ET',
      ),
      rawType1Pdf(
        'BT /F1 12 Tf 1 0 0 1 60 700 Tm (Alice Brown) Tj ET BT /F1 12 Tf 1 0 0 1 130 700 Tm (01632) Tj ET BT /F1 12 Tf 1 0 0 1 168 700 Tm (960123) Tj ET',
      ),
      rawType1Pdf('BT /F1 12 Tf 0 1 -1 0 300 300 Tm (Alice) Tj ET'),
    ]

    for (const bytes of fixtures) {
      const [exact, itemText] = await Promise.all([
        extractDocumentContent('pdf', bytes),
        itemPathText(bytes),
      ])
      expect(exact.text).toBe(itemText)
      expect(documentTextLayoutSchema.safeParse(exact.layout).success).toBe(
        true,
      )
    }
  })

  it('uses a kerned glyph own advance as its trailing cover width', async () => {
    const kerned = rawType1Pdf(
      'BT /F1 24 Tf 1 0 0 1 60 700 Tm [(T) 120 (o)] TJ ET',
    )
    const solo = rawType1Pdf('BT /F1 24 Tf 1 0 0 1 60 700 Tm (T) Tj ET')
    const extracted = await extractDocumentContent('pdf', kerned)
    const segment = extracted.layout!.segments[0]!
    expect(segment.advances?.[0]).toBeCloseTo(11.784, 3)
    expect(segment.glyphWidthOverrides?.['0']).toBeCloseTo(14.664, 3)

    const covers = coverRectsForSpan({
      segments: extracted.layout!.segments,
      spanStart: 0,
      spanEnd: 1,
      spanText: 'T',
    })
    const ink = await renderedInkBounds(solo)
    const covered = coverBoundsInViewport(ink.viewport, covers)
    expect(covered.right).toBeGreaterThanOrEqual(ink.right)
  })

  it('extracts rotated text in writing order and fail-safe covers its ink', async () => {
    const bytes = rawType1Pdf('BT /F1 12 Tf 0 1 -1 0 300 300 Tm (Alice) Tj ET')
    const extracted = await extractDocumentContent('pdf', bytes)
    expect(extracted.text).toBe('Alice')
    expect(extracted.text).not.toContain('\n')

    const covers = coverRectsForSpan({
      segments: extracted.layout!.segments,
      spanStart: 0,
      spanEnd: extracted.text.length,
      spanText: extracted.text,
    })
    const ink = await renderedInkBounds(bytes)
    const covered = coverBoundsInViewport(ink.viewport, covers)
    expect(covered.left).toBeLessThanOrEqual(ink.left)
    expect(covered.right).toBeGreaterThanOrEqual(ink.right)
    expect(covered.top).toBeLessThanOrEqual(ink.top)
    expect(covered.bottom).toBeGreaterThanOrEqual(ink.bottom)
  })

  it('applies a Form XObject matrix to extracted glyph covers', async () => {
    const bytes = rawFormPdf()
    const extracted = await extractDocumentContent('pdf', bytes)
    expect(extracted.text).toBe('Alice')

    const covers = coverRectsForSpan({
      segments: extracted.layout!.segments,
      spanStart: 0,
      spanEnd: extracted.text.length,
      spanText: extracted.text,
    })
    const ink = await renderedInkBounds(bytes)
    const covered = coverBoundsInViewport(ink.viewport, covers)
    expect(covered.left).toBeLessThanOrEqual(ink.left)
    expect(covered.right).toBeGreaterThanOrEqual(ink.right)
    expect(covered.top).toBeLessThanOrEqual(ink.top)
    expect(covered.bottom).toBeGreaterThanOrEqual(ink.bottom)
  })

  it('falls back from Type 3 replay and sanitises non-finite font metrics', async () => {
    const bytes = rawType3Pdf()
    const extracted = await extractDocumentContent('pdf', bytes)
    const layout = documentTextLayoutSchema.parse(extracted.layout)
    expect(extracted.text).toBe('AAA')
    expect(layout.segments[0]?.width).toBeCloseTo(36, 3)
    expect(
      layout.segments.every(
        (segment) =>
          Number.isFinite(segment.ascent) && Number.isFinite(segment.descent),
      ),
    ).toBe(true)

    const covers = coverRectsForSpan({
      segments: layout.segments,
      spanStart: 0,
      spanEnd: extracted.text.length,
      spanText: extracted.text,
    })
    const ink = await renderedInkBounds(bytes)
    const covered = coverBoundsInViewport(ink.viewport, covers)
    expect(covered.left).toBeLessThanOrEqual(ink.left)
    expect(covered.right).toBeGreaterThanOrEqual(ink.right)
    expect(covered.top).toBeLessThanOrEqual(ink.top)
    expect(covered.bottom).toBeGreaterThanOrEqual(ink.bottom)
  })

  it('uses pdf.js bidi text semantics when operator glyphs are visual RTL', async () => {
    const bytes = rawRtlPdf()
    const [extracted, itemText] = await Promise.all([
      extractDocumentContent('pdf', bytes),
      itemPathText(bytes),
    ])

    expect(extracted.text).toBe('שלום')
    expect(extracted.text).toBe(itemText)
    expect(documentTextLayoutSchema.safeParse(extracted.layout).success).toBe(
      true,
    )
  })

  it('fails closed when a page uses vertical glyph metrics', async () => {
    await expect(
      extractDocumentContent('pdf', rawVerticalPdf()),
    ).rejects.toThrow('cannot be redacted safely')
  })

  it('fails closed when a text matrix skews the glyph axes', async () => {
    const bytes = rawType1Pdf('BT /F1 12 Tf 1 0 0.4 1 60 700 Tm (Alice) Tj ET')
    await expect(extractDocumentContent('pdf', bytes)).rejects.toThrow(
      'cannot be redacted safely',
    )
  })

  it('fails closed when skewed text reaches the interpolated item path', async () => {
    // A Type 3 font bypasses operator replay, so the skew rejection must also
    // hold on the item fallback that pages like this one use.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(
        extractDocumentContent('pdf', rawType3Pdf('1 0 0.4 1 60 700')),
      ).rejects.toThrow('cannot be redacted safely')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('claim-form word boundaries', () => {
  // Synthetic claim-form lines (never real legal text): all-caps headings, a
  // damages figure, and a spaced NI number.
  const LINES = [
    'IN THE COUNTY COURT AT CENTRAL LONDON',
    'PARTICULARS OF CLAIM',
    'The Claimant claims damages totalling GBP 162,526.25',
    'NI number QQ 12 34 56 C was recorded',
  ]

  /** One drawText per line: real space glyphs, the well-formed producer. */
  async function spacedClaimFormPdf() {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.TimesRoman)
    const page = doc.addPage([595, 842])
    LINES.forEach((line, index) => {
      page.drawText(line, {
        x: START_X,
        y: BASELINE - index * 24,
        size: SIZE,
        font,
      })
    })
    return Buffer.from(await doc.save())
  }

  /**
   * Word-by-word at the running advance: zero inter-word advance, the fused
   * producer. Per-character advance sums (drawText emits no kerning) so the
   * gap is truly zero, matching the measured failure mode.
   */
  async function fusedClaimFormPdf() {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.TimesRoman)
    const page = doc.addPage([595, 842])
    LINES.forEach((line, index) => {
      let x = START_X
      for (const word of line.split(' ')) {
        page.drawText(word, {
          x,
          y: BASELINE - index * 24,
          size: SIZE,
          font,
        })
        x += drawnAdvance(font, word)
      }
    })
    return Buffer.from(await doc.save())
  }

  it('keeps word boundaries on all-caps claim-form lines', async () => {
    const extracted = await extractDocumentContent(
      'pdf',
      await spacedClaimFormPdf(),
    )

    expect(extracted.text).toContain('IN THE COUNTY COURT AT CENTRAL LONDON')
    expect(extracted.text).toContain('PARTICULARS OF CLAIM')
    expect(extracted.text).toContain('totalling GBP 162,526.25')
    // The spaced NI survives extraction, so deterministic detection fires and
    // the end-to-end redacted output carries no trace of it.
    const spans = supplementSpans(extracted.text)
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'national_insurance',
          text: 'QQ 12 34 56 C',
        }),
      ]),
    )
    const decisions = Object.fromEntries(
      spans.map((span) => [
        span.id,
        {
          decision: 'accept' as const,
          decidedBy: 'test',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )
    const redacted = applyRedacted(extracted.text, spans, decisions)
    expect(redacted).not.toContain('QQ 12 34 56 C')
    expect(redacted).toContain('[REDACTED]')
    expect(findUncoveredPdfRegions(extracted.text)).toEqual([])
  })

  it('flags zero-advance fusion, where the fused NI evades detection', async () => {
    const extracted = await extractDocumentContent(
      'pdf',
      await fusedClaimFormPdf(),
    )

    // True zero-gap fusion is faithful extraction: the rendered page shows no
    // spaces, and intra- and inter-word gaps both measure 0.00pt, so no
    // threshold can recover the boundaries.
    expect(extracted.text).toContain('PARTICULARSOFCLAIM')
    expect(extracted.text).not.toContain('IN THE COUNTY')
    // The NI fused to its neighbours matches no pattern (no boundary either
    // side), so the coverage guard must refuse finalisation instead.
    expect(
      supplementSpans(extracted.text).filter(
        (span) => span.category === 'national_insurance',
      ),
    ).toEqual([])
    const regions = findUncoveredPdfRegions(extracted.text)
    expect(regions).toHaveLength(1)
    expect(regions[0]).toContain('fused-text')
  })
})

describe('annotation glyph placement', () => {
  const SECRET = 'SECRETVALUE'

  function spanCover(input: {
    layout: DocumentTextLayout
    text: string
    spanText: string
  }) {
    const spanStart = input.text.indexOf(input.spanText)
    expect(spanStart).toBeGreaterThanOrEqual(0)
    const covers = coverRectsForSpan({
      segments: input.layout.segments,
      spanStart,
      spanEnd: spanStart + input.spanText.length,
      spanText: input.spanText,
    })
    expect(covers).toHaveLength(1)
    return covers[0]!
  }

  function acceptedSpanInput(
    pdfBytes: Buffer,
    layout: DocumentTextLayout,
    text: string,
    spanText: string,
  ) {
    const spanStart = text.indexOf(spanText)
    expect(spanStart).toBeGreaterThanOrEqual(0)
    return {
      pdfBytes,
      layout,
      spans: [
        {
          id: 'span_1',
          start: spanStart,
          end: spanStart + spanText.length,
          text: spanText,
          category: 'person_name' as const,
          source: 'rampart_model' as const,
          confidence: 'high' as const,
          suggestion: 'redact' as const,
        },
      ],
      decisions: {
        span_1: {
          decision: 'accept' as const,
          decidedBy: 'test',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      outputMode: 'redacted' as const,
      tokenMap: {},
    }
  }

  interface PageRect {
    x: number
    y: number
    width: number
    height: number
  }

  async function rasterizePdf(bytes: Uint8Array) {
    const CanvasFactory = await createIsomorphicCanvasFactory(
      () => import('@napi-rs/canvas'),
    )
    const pdf = await getDocumentProxy(Uint8Array.from(bytes), {
      CanvasFactory,
    })
    try {
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2 })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      await page.render({
        canvasContext: context as never,
        viewport,
        canvas: canvas as never,
      }).promise
      return { viewport, pixels: context.getImageData(0, 0, width, height) }
    } finally {
      await pdf.destroy()
    }
  }

  function deviceBox(
    viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
    rect: PageRect,
  ) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height,
    ])
    return {
      left: Math.floor(Math.min(x1, x2)),
      right: Math.ceil(Math.max(x1, x2)),
      top: Math.floor(Math.min(y1, y2)),
      bottom: Math.ceil(Math.max(y1, y2)),
    }
  }

  function isDark(data: Uint8ClampedArray, offset: number) {
    return (
      (data[offset] ?? 255) < 128 &&
      (data[offset + 1] ?? 255) < 128 &&
      (data[offset + 2] ?? 255) < 128
    )
  }

  /**
   * Every dark source pixel inside `rect` must be black in the burned
   * output: proves the value's ink is covered, not just the cover box.
   */
  async function expectSourceInkCovered(
    source: Buffer,
    output: Uint8Array,
    rect: PageRect,
  ) {
    const [sourcePage, outputPage] = await Promise.all([
      rasterizePdf(source),
      rasterizePdf(output),
    ])
    const box = deviceBox(sourcePage.viewport, rect)
    let inkPixels = 0
    for (let y = box.top; y < box.bottom; y += 1) {
      for (let x = box.left; x < box.right; x += 1) {
        const offset = (y * sourcePage.pixels.width + x) * 4
        if (!isDark(sourcePage.pixels.data, offset)) continue
        inkPixels += 1
        const brightest = Math.max(
          outputPage.pixels.data[offset] ?? 255,
          outputPage.pixels.data[offset + 1] ?? 255,
          outputPage.pixels.data[offset + 2] ?? 255,
        )
        expect(brightest).toBeLessThan(20)
      }
    }
    // The value must actually render, or the check above is vacuous.
    expect(inkPixels).toBeGreaterThan(50)
  }

  /** Body text outside the bar must still render: the bar is local, not page-wide. */
  async function expectInkPresent(output: Uint8Array, strip: PageRect) {
    const { viewport, pixels } = await rasterizePdf(output)
    const box = deviceBox(viewport, strip)
    let darkest = 255
    for (let y = box.top; y < box.bottom; y += 1) {
      for (let x = box.left; x < box.right; x += 1) {
        const offset = (y * pixels.width + x) * 4
        darkest = Math.min(
          darkest,
          pixels.data[offset] ?? 255,
          pixels.data[offset + 1] ?? 255,
          pixels.data[offset + 2] ?? 255,
        )
      }
    }
    expect(darkest).toBeLessThan(128)
  }

  async function expectNoSelectableText(output: Uint8Array, absent: string) {
    const pdf = await getDocumentProxy(Uint8Array.from(output))
    try {
      const { text } = await extractText(pdf, { mergePages: true })
      const joined = (Array.isArray(text) ? text.join(' ') : text).trim()
      expect(joined).not.toContain(absent)
    } finally {
      await pdf.destroy()
    }
  }

  it('lays a text-field value at the widget rectangle', async () => {
    const { bytes, rect } = await textFieldPdf(SECRET)
    const extracted = await extractDocumentContent('pdf', bytes)
    expect(extracted.text).toContain('BODYTEXT')
    expect(extracted.text).toContain(SECRET)

    const cover = spanCover({
      layout: extracted.layout!,
      text: extracted.text,
      spanText: SECRET,
    })
    // Without beginAnnotation replay this cover sat at the page origin.
    expect(cover.y).toBeGreaterThan(200)
    expect(cover.x).toBeGreaterThanOrEqual(rect.x - 2)
    expect(cover.y).toBeGreaterThanOrEqual(rect.y - 3)
    expect(cover.x + cover.width).toBeLessThanOrEqual(rect.x + rect.width + 1)
    expect(cover.y + cover.height).toBeLessThanOrEqual(rect.y + rect.height + 2)

    const output = await buildRedactedPdf(
      acceptedSpanInput(bytes, extracted.layout!, extracted.text, SECRET),
    )
    await expectSourceInkCovered(bytes, output, rect)
    await expectInkPresent(output, { x: 60, y: 698, width: 140, height: 16 })
    await expectNoSelectableText(output, SECRET)
  })

  it('lays a free-text annotation value at the annotation rectangle', async () => {
    const { bytes, rect } = rawFreeTextPdf()
    const extracted = await extractDocumentContent('pdf', bytes)
    expect(extracted.text).toContain('BODYTEXT')
    expect(extracted.text).toContain(SECRET)

    const cover = spanCover({
      layout: extracted.layout!,
      text: extracted.text,
      spanText: SECRET,
    })
    expect(cover.y).toBeGreaterThan(200)
    expect(cover.x).toBeGreaterThanOrEqual(rect.x - 2)
    expect(cover.y).toBeGreaterThanOrEqual(rect.y - 3)
    expect(cover.x + cover.width).toBeLessThanOrEqual(rect.x + rect.width + 1)
    expect(cover.y + cover.height).toBeLessThanOrEqual(rect.y + rect.height + 2)

    const output = await buildRedactedPdf(
      acceptedSpanInput(bytes, extracted.layout!, extracted.text, SECRET),
    )
    await expectSourceInkCovered(Buffer.from(bytes), output, rect)
    await expectInkPresent(output, { x: 60, y: 698, width: 140, height: 16 })
    await expectNoSelectableText(output, SECRET)
  })

  it('keeps no-annotation cover geometry identical to the pinned baseline', async () => {
    const { bytes } = await singleLinePdf(
      'Ms Wilhelmina Ashcroft-Hargreaves of 14 St Aldgate Terrace, Oxford',
    )
    const extracted = await extractDocumentContent('pdf', bytes)
    // Annotation and nextLine handling must not move plain content-stream
    // text: these pins predate both fixes.
    const cover = spanCover({
      layout: extracted.layout!,
      text: extracted.text,
      spanText: 'Oxford',
    })
    expect(cover.x).toBeCloseTo(340.29, 1)
    expect(cover.y).toBeCloseTo(696.73, 1)
    expect(cover.width).toBeCloseTo(32.65, 1)
    expect(cover.height).toBeCloseTo(11.66, 1)
  })
})
