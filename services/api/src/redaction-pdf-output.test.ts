import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'
import {
  buildRedactedPdf,
  padGlyphRect,
  redactedPdfFilename,
  redactedTextFilename,
} from './redaction-pdf-output'
import type { DocumentTextLayout } from './document-layout'

async function samplePdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Alice Smith', { x: 40, y: 100, size: 12, font })
  page.drawText('Visible later', { x: 40, y: 60, size: 12, font })
  return Buffer.from(await doc.save())
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

  it('rasterizes output so accepted span text cannot be extracted', async () => {
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
          y: 100,
          width: 30,
          height: 12,
        },
      ],
    }
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
          decision: 'accept',
          decidedBy: 'usr_1',
          decidedAt: '2026-07-29T00:00:00.000Z',
        },
      },
      outputMode: 'redacted',
      tokenMap: {},
    })

    expect(output.byteLength).toBeGreaterThan(100)
    const reloaded = await PDFDocument.load(output)
    expect(reloaded.getPageCount()).toBe(1)

    const pdf = await getDocumentProxy(Uint8Array.from(output))
    const { text } = await extractText(pdf, { mergePages: true })
    const joined = (Array.isArray(text) ? text.join(' ') : text).trim()
    // Image-only pages expose no text layer — including non-redacted words.
    expect(joined).toBe('')
  })

  it('still produces a valid PDF when every span is rejected', async () => {
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
          y: 100,
          width: 30,
          height: 12,
        },
      ],
    }
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
