import { PDFDocument, StandardFonts } from 'pdf-lib'
import { coverRectsForSpan } from '@obiter/redaction-policy'
import { describe, expect, it } from 'vitest'
import { extractDocumentContent } from './document-extraction'

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
})
