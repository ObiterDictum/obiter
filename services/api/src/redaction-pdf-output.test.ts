import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  createIsomorphicCanvasFactory,
  extractText,
  getDocumentProxy,
} from 'unpdf'
import { coverRectsForSpan } from '@obiter/redaction-policy'
import { describe, expect, it } from 'vitest'
import {
  buildRedactedPdf,
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

function acceptedAliceInput(pdfBytes: Buffer, layout: DocumentTextLayout) {
  return {
    pdfBytes,
    layout,
    spans: [
      {
        id: 'span_1',
        start: 0,
        end: 5,
        text: 'Alice',
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

function isNearBlack(r: number, g: number, b: number) {
  return r < 20 && g < 20 && b < 20
}

async function sampleOutputPixels(
  output: Uint8Array,
  points: Array<{ x: number; y: number }>,
) {
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const pdf = await getDocumentProxy(Uint8Array.from(output), { CanvasFactory })
  try {
    const page = await pdf.getPage(1)
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
      return { r: data[0]!, g: data[1]!, b: data[2]! }
    })
  } finally {
    await pdf.destroy()
  }
}

describe('redaction-pdf-output', () => {
  it('names redacted PDF and text downloads from the source filename', () => {
    expect(redactedPdfFilename('brief.pdf')).toBe('brief-redacted.pdf')
    expect(redactedTextFilename('brief.docx')).toBe('brief-redacted.txt')
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

  it('rasterizes output so accepted span pixels are black and other text is not', async () => {
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
    const [coverPixel, visiblePixel] = await sampleOutputPixels(output, [
      { x: cover.x + cover.width / 2, y: cover.y + cover.height / 2 },
      // Centre of the "Visible later" baseline ink, well clear of Alice's bar.
      { x: 70, y: 64 },
    ])

    expect(isNearBlack(coverPixel!.r, coverPixel!.g, coverPixel!.b)).toBe(true)
    expect(isNearBlack(visiblePixel!.r, visiblePixel!.g, visiblePixel!.b)).toBe(
      false,
    )
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

  it('still produces a valid PDF when every span is rejected', async () => {
    const pdfBytes = await samplePdf()
    const layout = aliceLayout()
    const output = await buildRedactedPdf({
      pdfBytes,
      layout,
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
})
