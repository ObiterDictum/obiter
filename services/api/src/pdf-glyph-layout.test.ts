import { createCanvas } from '@napi-rs/canvas'
import { documentTextLayoutSchema } from '@obiter/contracts'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { coverRectsForSpan, supplementSpans } from '@obiter/redaction-policy'
import { createIsomorphicCanvasFactory, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { extractDocumentContent, prepareLaidChars } from './document-extraction'
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

/** Minimal one-page Type1 PDF for operators pdf-lib cannot emit. */
function rawType1Pdf(content: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
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
  return {
    left: Math.min(...rectangles.map((rect) => rect.left)),
    right: Math.max(...rectangles.map((rect) => rect.right)),
    top: Math.min(...rectangles.map((rect) => rect.top)),
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
  }
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
})
