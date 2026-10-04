import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  createIsomorphicCanvasFactory,
  extractText,
  getDocumentProxy,
} from 'unpdf'
import {
  coalesceRedactionRegions,
  coverRectsForSpan,
  type RedactionSpan,
} from '@obiter/redaction-policy'
import { describe, expect, it } from 'bun:test'
import {
  buildRedactedPdf,
  isDocumentTextLayout,
  padGlyphRect,
  RedactionCoverGeometryError,
  redactedPdfFilename,
  redactedTextFilename,
} from './redaction-pdf-output'
import type { DocumentTextLayout } from './document-layout'

const RENDER_SCALE = 2

async function samplePdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Alice Smith', { x: 40, y: 100, size: 12, font })
  page.drawText('Visible later', { x: 40, y: 60, size: 12, font })
  return Buffer.from(await doc.save())
}

function aliceLayout(): DocumentTextLayout {
  return {
    version: 1,
    pages: [{ width: 200, height: 200 }],
    segments: [
      {
        start: 0,
        end: 5,
        pageIndex: 0,
        x: 40,
        y: 100,
        width: 30,
        height: 12,
      },
    ],
  }
}

function acceptedSpanInput(
  pdfBytes: Buffer,
  layout: DocumentTextLayout,
  spanText: string,
) {
  return {
    pdfBytes,
    layout,
    text: spanText,
    spans: [
      {
        id: 'span_1',
        start: 0,
        end: spanText.length,
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
        decidedBy: 'usr_1',
        decidedAt: '2026-07-29T00:00:00.000Z',
      },
    },
    outputMode: 'redacted' as const,
    tokenMap: {},
  }
}

function acceptedAliceInput(pdfBytes: Buffer, layout: DocumentTextLayout) {
  return acceptedSpanInput(pdfBytes, layout, 'Alice')
}

function wordSpan(
  text: string,
  word: string,
  id: string,
  from = 0,
): RedactionSpan {
  const start = text.indexOf(word, from)
  if (start === -1) throw new Error(`missing ${word} in test text`)
  return {
    id,
    start,
    end: start + word.length,
    text: word,
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

function acceptAll(spans: RedactionSpan[]) {
  return Object.fromEntries(
    spans.map((span) => [
      span.id,
      {
        decision: 'accept' as const,
        decidedBy: 'usr_1',
        decidedAt: '2026-07-29T00:00:00.000Z',
      },
    ]),
  )
}

/** Horizontal centre of each character, from a layout advance list. */
function charCenters(advances: number[], origin: number) {
  const centers: number[] = []
  let cursor = origin
  for (const advance of advances) {
    centers.push(cursor + advance / 2)
    cursor += advance
  }
  return centers
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function textLayout(input: {
  pages: Array<{ width: number; height: number }>
  segments: DocumentTextLayout['segments']
}): DocumentTextLayout {
  return { version: 2, pages: input.pages, segments: input.segments }
}

interface DrawnLine {
  text: string
  x: number
  y: number
  pageIndex: number
}

/** A synthetic PDF plus matching layout for one or more drawn lines. */
async function pdfWithLines(lines: DrawnLine[]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pageCount = Math.max(...lines.map((line) => line.pageIndex)) + 1
  const pages = Array.from({ length: pageCount }, () => ({
    width: 400,
    height: 200,
  }))
  const pdfPages = pages.map(() => doc.addPage([400, 200]))
  const segments: DocumentTextLayout['segments'] = []
  const advancesByLine: number[][] = []
  let offset = 0
  for (const line of lines) {
    pdfPages[line.pageIndex]!.drawText(line.text, {
      x: line.x,
      y: line.y,
      size: 12,
      font,
    })
    const advances = [...line.text].map((char) =>
      font.widthOfTextAtSize(char, 12),
    )
    advancesByLine.push(advances)
    segments.push({
      start: offset,
      end: offset + line.text.length,
      pageIndex: line.pageIndex,
      x: line.x,
      y: line.y,
      width: sum(advances),
      height: 12,
      advances,
      glyphWidthOverrides: {},
    })
    offset += line.text.length
  }
  return {
    pdfBytes: Buffer.from(await doc.save()),
    layout: textLayout({ pages, segments }),
    advancesByLine,
    text: lines.map((line) => line.text).join(''),
  }
}

/**
 * A cover paint is opaque black. Alpha matters: `getImageData` returns
 * `(0,0,0,0)` for an unpainted pixel, and RGB alone would call that black.
 */
function isNearBlack(r: number, g: number, b: number, a: number) {
  return a >= 250 && r < 20 && g < 20 && b < 20
}

async function sampleOutputPixels(
  output: Uint8Array,
  points: Array<{ x: number; y: number }>,
  pageNumber = 1,
) {
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const pdf = await getDocumentProxy(Uint8Array.from(output), { CanvasFactory })
  try {
    const page = await pdf.getPage(pageNumber)
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
    return points.map((point) => {
      const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
        point.x,
        point.y,
        point.x + 1,
        point.y + 1,
      ])
      const px = Math.round((Math.min(vx1, vx2) + Math.max(vx1, vx2)) / 2)
      const py = Math.round((Math.min(vy1, vy2) + Math.max(vy1, vy2)) / 2)
      const clampedX = Math.min(Math.max(px, 0), width - 1)
      const clampedY = Math.min(Math.max(py, 0), height - 1)
      const data = context.getImageData(clampedX, clampedY, 1, 1).data
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! }
    })
  } finally {
    await pdf.destroy()
  }
}

describe('redaction-pdf-output', () => {
  it('names redacted PDF and text downloads from the source filename', () => {
    expect(redactedPdfFilename('brief.pdf')).toBe('brief-redacted.pdf')
    expect(redactedPdfFilename('brief.docx')).toBe('brief-redacted.pdf')
    expect(redactedTextFilename('brief.docx')).toBe('brief-redacted.txt')
  })

  it('validates every stored layout number and keeps legacy layouts readable', () => {
    expect(isDocumentTextLayout(aliceLayout())).toBe(true)
    expect(
      isDocumentTextLayout({
        version: 2,
        pages: [{ width: 200, height: 200 }],
        segments: [
          {
            start: 0,
            end: 2,
            pageIndex: 0,
            x: 40,
            y: 100,
            width: 12,
            height: 12,
            advances: [Number.NaN, 6],
            glyphWidthOverrides: {},
          },
        ],
      }),
    ).toBe(false)
  })

  it('pads deep only when the covered ink has descenders', () => {
    const withJ = padGlyphRect({
      x: 40,
      y: 100,
      width: 30,
      height: 12,
      ink: 'James',
    })
    const plain = padGlyphRect({
      x: 40,
      y: 100,
      width: 30,
      height: 12,
      ink: 'Alice',
    })
    expect(withJ.y + withJ.height).toBeCloseTo(plain.y + plain.height, 5)
    expect(100 - withJ.y).toBeGreaterThan(100 - plain.y)
    expect(withJ.x).toBeLessThan(plain.x)
  })

  it('rasterizes output so the accepted span bar is opaque black and the page is not', async () => {
    const pdfBytes = await samplePdf()
    const layout = aliceLayout()
    const output = await buildRedactedPdf(acceptedAliceInput(pdfBytes, layout))

    expect(output.byteLength).toBeGreaterThan(100)
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(1)

    const pdf = await getDocumentProxy(Uint8Array.from(output))
    const { text } = await extractText(pdf, { mergePages: true })
    const joined = (Array.isArray(text) ? text.join(' ') : text).trim()
    expect(joined).toBe('')

    const covers = coverRectsForSpan({
      segments: layout.segments,
      spanStart: 0,
      spanEnd: 5,
      spanText: 'Alice',
    })
    expect(covers.length).toBeGreaterThan(0)
    const cover = covers[0]!
    const [coverPixel, backgroundPixel] = await sampleOutputPixels(output, [
      { x: cover.x + cover.width / 2, y: cover.y + cover.height / 2 },
      // Deterministic page background above every glyph and every bar.
      { x: 100, y: 180 },
    ])

    expect(
      isNearBlack(coverPixel!.r, coverPixel!.g, coverPixel!.b, coverPixel!.a),
    ).toBe(true)
    expect(
      isNearBlack(
        backgroundPixel!.r,
        backgroundPixel!.g,
        backgroundPixel!.b,
        backgroundPixel!.a,
      ),
    ).toBe(false)
  })

  it('throws when an output-affecting span has no cover geometry', async () => {
    const pdfBytes = await samplePdf()
    const layout: DocumentTextLayout = {
      version: 1,
      pages: [{ width: 200, height: 200 }],
      segments: [
        {
          // Offsets do not overlap the accepted span at 0–5.
          start: 100,
          end: 105,
          pageIndex: 0,
          x: 40,
          y: 100,
          width: 30,
          height: 12,
        },
      ],
    }

    await expect(
      buildRedactedPdf(acceptedAliceInput(pdfBytes, layout)),
    ).rejects.toMatchObject({
      name: 'RedactionCoverGeometryError',
      spanIds: ['span_1'],
    })
    await expect(
      buildRedactedPdf(acceptedAliceInput(pdfBytes, layout)),
    ).rejects.toBeInstanceOf(RedactionCoverGeometryError)
  })

  it('accepts a cover on a page whose box does not start at the origin', async () => {
    // The stored layout records width/height only. A page with an offset
    // MediaBox must not be judged against [0, width], or visible text near the
    // right edge is refused as off-page.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([622, 802])
    page.setMediaBox(10, 10, 622, 802)
    page.drawText('I', { x: 625, y: 400, size: 12, font })
    const pdfBytes = Buffer.from(await doc.save())
    const layout: DocumentTextLayout = {
      version: 2,
      pages: [{ width: 622, height: 802 }],
      segments: [
        {
          start: 0,
          end: 1,
          pageIndex: 0,
          x: 625,
          y: 400,
          width: 3.996,
          height: 12,
          ascent: 8.196,
          descent: 2.604,
          advances: [3.996],
          glyphWidthOverrides: {},
        },
      ],
    }

    await expect(
      buildRedactedPdf(acceptedSpanInput(pdfBytes, layout, 'I')),
    ).resolves.toBeInstanceOf(Uint8Array)
  })

  it('throws when an accepted span cover misses the page entirely', async () => {
    const pdfBytes = await samplePdf()
    const layout: DocumentTextLayout = {
      version: 1,
      pages: [{ width: 200, height: 200 }],
      segments: [
        {
          start: 0,
          end: 5,
          pageIndex: 0,
          x: 40,
          // Above the 200pt page: the cover would paint nothing.
          y: 400,
          width: 30,
          height: 12,
        },
      ],
    }

    await expect(
      buildRedactedPdf(acceptedAliceInput(pdfBytes, layout)),
    ).rejects.toMatchObject({
      name: 'RedactionCoverGeometryError',
      spanIds: ['span_1'],
    })
  })

  it('names every span in a coalesced region that misses the page', async () => {
    const pdfBytes = await samplePdf()
    const text = 'John Michael'
    const layout = textLayout({
      pages: [{ width: 200, height: 200 }],
      segments: [
        {
          start: 0,
          end: 4,
          pageIndex: 0,
          x: 40,
          y: 400,
          width: 25,
          height: 12,
        },
        {
          start: 5,
          end: 12,
          pageIndex: 0,
          x: 68,
          y: 400,
          width: 45,
          height: 12,
        },
      ],
    })
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Michael', 'span_michael'),
    ]
    await expect(
      buildRedactedPdf({
        pdfBytes,
        layout,
        text,
        spans,
        decisions: acceptAll(spans),
        outputMode: 'redacted',
        tokenMap: {},
      }),
    ).rejects.toMatchObject({
      name: 'RedactionCoverGeometryError',
      spanIds: ['span_john', 'span_michael'],
    })
  })

  it('still produces a valid PDF when every span is rejected', async () => {
    const pdfBytes = await samplePdf()
    const layout = aliceLayout()
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text: 'Alice',
      spans: [
        {
          id: 'span_1',
          start: 0,
          end: 5,
          text: 'Alice',
          category: 'person_name',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
      decisions: {
        span_1: {
          decision: 'reject',
          decidedBy: 'usr_1',
          decidedAt: '2026-07-29T00:00:00.000Z',
        },
      },
      outputMode: 'redacted',
      tokenMap: {},
    })

    const pdf = await getDocumentProxy(Uint8Array.from(output))
    const { text } = await extractText(pdf, { mergePages: true })
    const joined = (Array.isArray(text) ? text.join(' ') : text).trim()
    expect(joined).toBe('')
    expect(output.byteLength).toBeGreaterThan(100)
  })

  it('plans one cover rect across three adjacent accepted words', async () => {
    const { pdfBytes, layout, text, advancesByLine } = await pdfWithLines([
      { text: 'John Michael Smith', x: 40, y: 100, pageIndex: 0 },
    ])
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Michael', 'span_michael'),
      wordSpan(text, 'Smith', 'span_smith'),
    ]
    const decisions = acceptAll(spans)
    // Geometry plan, independent of any rasterizer: one region, one rect.
    expect(coalesceRedactionRegions(text, spans, decisions)).toEqual([
      {
        start: 0,
        end: 18,
        spanIds: ['span_john', 'span_michael', 'span_smith'],
      },
    ])
    const covers = coverRectsForSpan({
      segments: layout.segments,
      spanStart: 0,
      spanEnd: 18,
      spanText: text,
      mergeWhitespace: true,
    })
    expect(covers).toHaveLength(1)
    const cover = covers[0]!
    const centers = charCenters(advancesByLine[0]!, 40)
    // The rect spans the whitespace between the words, not just their glyphs.
    for (const index of [4, 12]) {
      expect(centers[index]!).toBeGreaterThan(cover.x)
      expect(centers[index]!).toBeLessThan(cover.x + cover.width)
    }
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text,
      spans,
      decisions,
      outputMode: 'redacted',
      tokenMap: {},
    })
    const pixels = await sampleOutputPixels(output, [
      { x: centers[4]!, y: 106 },
      { x: centers[12]!, y: 106 },
    ])
    for (const pixel of pixels)
      expect(isNearBlack(pixel.r, pixel.g, pixel.b, pixel.a)).toBe(true)
  })

  it('merges a whitespace gap wider than a single space into one bar', async () => {
    // Two spaces between each word: per-span bars would leave a visible white
    // gap, while coalescing paints one continuous bar.
    const { pdfBytes, layout, text, advancesByLine } = await pdfWithLines([
      { text: 'John  Michael  Smith', x: 40, y: 100, pageIndex: 0 },
    ])
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Michael', 'span_michael'),
      wordSpan(text, 'Smith', 'span_smith'),
    ]
    const covers = coverRectsForSpan({
      segments: layout.segments,
      spanStart: 0,
      spanEnd: text.length,
      spanText: text,
      mergeWhitespace: true,
    })
    expect(covers).toHaveLength(1)
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text,
      spans,
      decisions: acceptAll(spans),
      outputMode: 'redacted',
      tokenMap: {},
    })
    const centers = charCenters(advancesByLine[0]!, 40)
    const pixels = await sampleOutputPixels(output, [
      { x: centers[4]!, y: 106 },
      { x: centers[13]!, y: 106 },
    ])
    for (const pixel of pixels)
      expect(isNearBlack(pixel.r, pixel.g, pixel.b, pixel.a)).toBe(true)
  })

  it('does not merge across a visible unredacted word', async () => {
    const { pdfBytes, layout, text, advancesByLine } = await pdfWithLines([
      { text: 'John and Smith', x: 40, y: 100, pageIndex: 0 },
    ])
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Smith', 'span_smith'),
    ]
    const decisions = acceptAll(spans)
    // The visible word forbids one region at the source level, so the plan
    // holds two rects even though both spans share a baseline.
    expect(coalesceRedactionRegions(text, spans, decisions)).toEqual([
      { start: 0, end: 4, spanIds: ['span_john'] },
      { start: 9, end: 14, spanIds: ['span_smith'] },
    ])
    const covers = coalesceRedactionRegions(text, spans, decisions).flatMap(
      (region) =>
        coverRectsForSpan({
          segments: layout.segments,
          spanStart: region.start,
          spanEnd: region.end,
          spanText: text.slice(region.start, region.end),
          mergeWhitespace: true,
        }),
    )
    expect(covers).toHaveLength(2)
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text,
      spans,
      decisions,
      outputMode: 'redacted',
      tokenMap: {},
    })
    const centers = charCenters(advancesByLine[0]!, 40)
    // The space after the John bar, before the visible 'a'. Deterministic
    // background, never the glyph ink the old test sampled.
    const [gap] = await sampleOutputPixels(output, [{ x: centers[4]!, y: 106 }])
    expect(isNearBlack(gap!.r, gap!.g, gap!.b, gap!.a)).toBe(false)
  })

  it('splits a wrapped region into one bar per rendered line', async () => {
    const { pdfBytes, layout, text, advancesByLine } = await pdfWithLines([
      { text: 'John ', x: 40, y: 100, pageIndex: 0 },
      { text: 'Michael Smith', x: 40, y: 80, pageIndex: 0 },
    ])
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Michael', 'span_michael'),
      wordSpan(text, 'Smith', 'span_smith'),
    ]
    const covers = coverRectsForSpan({
      segments: layout.segments,
      spanStart: 0,
      spanEnd: text.length,
      spanText: text,
      mergeWhitespace: true,
    })
    expect(covers).toHaveLength(2)
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text,
      spans,
      decisions: acceptAll(spans),
      outputMode: 'redacted',
      tokenMap: {},
    })
    const centers1 = charCenters(advancesByLine[0]!, 40)
    const centers2 = charCenters(advancesByLine[1]!, 40)
    const [line1Glyph, line2Gap, betweenLines] = await sampleOutputPixels(
      output,
      [
        { x: centers1[1]!, y: 106 },
        { x: centers2[7]!, y: 86 },
        { x: centers2[3]!, y: 93 },
      ],
    )
    expect(
      isNearBlack(line1Glyph!.r, line1Glyph!.g, line1Glyph!.b, line1Glyph!.a),
    ).toBe(true)
    expect(
      isNearBlack(line2Gap!.r, line2Gap!.g, line2Gap!.b, line2Gap!.a),
    ).toBe(true)
    expect(
      isNearBlack(
        betweenLines!.r,
        betweenLines!.g,
        betweenLines!.b,
        betweenLines!.a,
      ),
    ).toBe(false)
  })

  it('does not merge redactions across PDF pages', async () => {
    const { pdfBytes, layout, text } = await pdfWithLines([
      { text: 'John ', x: 40, y: 100, pageIndex: 0 },
      { text: 'Michael', x: 40, y: 100, pageIndex: 1 },
    ])
    const spans = [
      wordSpan(text, 'John', 'span_john'),
      wordSpan(text, 'Michael', 'span_michael'),
    ]
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
      text,
      spans,
      decisions: acceptAll(spans),
      outputMode: 'redacted',
      tokenMap: {},
    })
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(2)
    const [firstPage] = await sampleOutputPixels(output, [{ x: 50, y: 106 }], 1)
    const [secondPage] = await sampleOutputPixels(
      output,
      [{ x: 50, y: 106 }],
      2,
    )
    expect(
      isNearBlack(firstPage!.r, firstPage!.g, firstPage!.b, firstPage!.a),
    ).toBe(true)
    expect(
      isNearBlack(secondPage!.r, secondPage!.g, secondPage!.b, secondPage!.a),
    ).toBe(true)
  })
})
