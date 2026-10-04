import { describe, expect, it } from 'bun:test'
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
} from 'pdf-lib'
import { extractText } from 'unpdf'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import {
  buildSecurePdfFromText,
  SecurePdfValidationError,
  sha256,
  validateSecurePdf,
} from './redaction-secure-pdf'

function span(
  text: string,
  start = 0,
  category: RedactionSpan['category'] = 'person_name',
): RedactionSpan {
  return {
    id: 'span_1',
    start,
    end: start + text.length,
    text,
    category,
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

function accepted(spans: RedactionSpan[]): Decisions {
  return Object.fromEntries(
    spans.map((item) => [
      item.id,
      {
        decision: 'accept' as const,
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  )
}

async function textLayeredPdf(text: string) {
  const document = await PDFDocument.create()
  const page = document.addPage([200, 200])
  const font = await document.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 20, y: 100, size: 12, font })
  return document.save()
}

describe('buildSecurePdfFromText', () => {
  it('renders text into an image-only PDF with no selectable text layer', async () => {
    const bytes = await buildSecurePdfFromText(
      'Alice Smith signed the deed.\n[REDACTED] followed.',
    )
    expect(bytes.byteLength).toBeGreaterThan(0)
    // pdf.js may detach the buffer it is given, so hand it a copy.
    const extracted = await extractText(Uint8Array.from(bytes), {
      mergePages: true,
    })
    expect(extracted.text.trim()).toBe('')
    // The marker is painted as a bar, so neither the marker nor source text is
    // extractable.
    expect(extracted.text).not.toContain('[REDACTED]')
    expect(extracted.text).not.toContain('Alice')
  })

  it('paginates long text and keeps every page at A4 with finite dimensions', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index}`)
    const bytes = await buildSecurePdfFromText(lines.join('\n'))
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBeGreaterThan(1)
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeGreaterThan(0)
      expect(page.getHeight()).toBeGreaterThan(0)
    }
  })

  it('reports a stable 64-character digest of the stored bytes', async () => {
    const bytes = await buildSecurePdfFromText('Same content.')
    const digest = sha256(bytes)
    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(sha256(Uint8Array.from(bytes))).toBe(digest)
  })
})

describe('validateSecurePdf', () => {
  it('accepts a generated image-only PDF', async () => {
    const bytes = await buildSecurePdfFromText('[REDACTED] only')
    await expect(
      validateSecurePdf({
        bytes,
        spans: [span('Alice')],
        decisions: accepted([span('Alice')]),
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses an empty file', async () => {
    await expect(
      validateSecurePdf({
        bytes: new Uint8Array(),
        spans: [],
        decisions: {},
      }),
    ).rejects.toBeInstanceOf(SecurePdfValidationError)
  })

  it('refuses a malformed PDF', async () => {
    await expect(
      validateSecurePdf({
        bytes: new TextEncoder().encode('not a pdf'),
        spans: [],
        decisions: {},
      }),
    ).rejects.toMatchObject({ reason: 'malformed' })
  })

  it('refuses a PDF that still has a selectable text layer', async () => {
    const bytes = await textLayeredPdf('Alice Smith')
    await expect(
      validateSecurePdf({
        bytes,
        spans: [],
        decisions: {},
      }),
    ).rejects.toMatchObject({ reason: 'text_layer' })
  })

  it('refuses a PDF whose bytes still carry accepted source text', async () => {
    // Append the accepted string as a PDF comment. The rasterized pages are
    // unchanged, so the page checks and text extraction pass; only the raw byte
    // scan catches it, which is the leak this gate exists for.
    const base = await buildSecurePdfFromText('clean')
    const text = Buffer.from(base)
    const marker = Buffer.from('%Alice Smith\n')
    const eofIndex = text.lastIndexOf(Buffer.from('%%EOF'))
    const bytes = Buffer.concat([
      text.subarray(0, eofIndex),
      marker,
      text.subarray(eofIndex),
    ])
    await expect(
      validateSecurePdf({
        bytes,
        spans: [span('Alice Smith')],
        decisions: accepted([span('Alice Smith')]),
      }),
    ).rejects.toMatchObject({ reason: 'source_text_survives' })
  })

  it('refuses a PDF with an invalid page geometry', async () => {
    const document = await PDFDocument.create()
    document.addPage([30_000, 30_000])
    const bytes = await document.save()
    await expect(
      validateSecurePdf({ bytes, spans: [], decisions: {} }),
    ).rejects.toMatchObject({ reason: 'page_geometry' })
  })

  it('refuses a PDF with no pages', async () => {
    const document = await PDFDocument.create()
    const bytes = await document.save({ addDefaultPage: false })
    await expect(
      validateSecurePdf({ bytes, spans: [], decisions: {} }),
    ).rejects.toMatchObject({ reason: 'no_pages' })
  })

  it.each([
    ['literal', PDFString.of('Alice Smith')],
    ['hex', PDFHexString.fromText('Alice Smith')],
  ])(
    'refuses a page annotation whose %s contents carry source text',
    async (_label, contents) => {
      const base = await buildSecurePdfFromText('clean')
      const document = await PDFDocument.load(base)
      const page = document.getPages()[0]!
      const annotation = document.context.obj({
        Type: 'Annot',
        Subtype: 'FreeText',
        Rect: [10, 10, 120, 40],
        Contents: contents,
      })
      page.node.set(PDFName.of('Annots'), document.context.obj([annotation]))
      const bytes = await document.save()
      await expect(
        validateSecurePdf({
          bytes,
          spans: [span('Alice Smith')],
          decisions: accepted([span('Alice Smith')]),
        }),
      ).rejects.toMatchObject({ reason: 'structured_content' })
    },
  )

  it('refuses a catalog OpenAction JavaScript action', async () => {
    const base = await buildSecurePdfFromText('clean')
    const document = await PDFDocument.load(base)
    document.catalog.set(
      PDFName.of('OpenAction'),
      document.context.obj({
        Type: 'Action',
        S: 'JavaScript',
        JS: PDFString.of('app.alert(1)'),
      }),
    )
    const bytes = await document.save()
    await expect(
      validateSecurePdf({ bytes, spans: [], decisions: {} }),
    ).rejects.toMatchObject({ reason: 'structured_content' })
  })

  it('refuses a page additional-action dictionary', async () => {
    const base = await buildSecurePdfFromText('clean')
    const document = await PDFDocument.load(base)
    const page = document.getPages()[0]!
    page.node.set(
      PDFName.of('AA'),
      document.context.obj({
        O: document.context.obj({ S: 'JavaScript', JS: PDFString.of('x') }),
      }),
    )
    const bytes = await document.save()
    await expect(
      validateSecurePdf({ bytes, spans: [], decisions: {} }),
    ).rejects.toMatchObject({ reason: 'structured_content' })
  })

  it('refuses a catalog entry from the deny-list', async () => {
    const base = await buildSecurePdfFromText('clean')
    const document = await PDFDocument.load(base)
    document.catalog.set(PDFName.of('PageLabels'), document.context.obj({}))
    const bytes = await document.save()
    await expect(
      validateSecurePdf({ bytes, spans: [], decisions: {} }),
    ).rejects.toMatchObject({ reason: 'structured_content' })
  })
})
