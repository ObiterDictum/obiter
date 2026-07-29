import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supplementSpans } from '@obiter/redaction-policy'

const unpdf = vi.hoisted(() => ({ getDocumentProxy: vi.fn() }))

vi.mock('unpdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('unpdf')>()),
  getDocumentProxy: unpdf.getDocumentProxy,
}))

import {
  DocumentExtractionError,
  extractDocumentText,
} from './document-extraction'

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
  unpdf.getDocumentProxy.mockReset()
  unpdf.getDocumentProxy.mockImplementation(actual.getDocumentProxy)
})

describe('extractDocumentText', () => {
  it('extracts text from the checked-in DOCX demo fixture', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    await expect(extractDocumentText('docx', fixture)).resolves.toContain(
      'Mr James Cartwright',
    )
  })

  it('extracts DOCX body, table, header and footer text', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/docx-edge-cases-fixture.docx',
    )

    const text = await extractDocumentText('docx', fixture)

    expect(text).toContain('Header: Alice Example')
    expect(text).toContain('Body: Jane Example')
    expect(text).toContain('Table: Sarah Example')
    expect(text).toContain('Footer: Bob Example')
  })

  it('joins text-layer PDF pages and preserves known PII without detaching the source buffer', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-text-layer-fixture.pdf',
    )
    const source = Buffer.from(fixture)
    await expect(extractDocumentText('pdf', source)).resolves.toContain(
      'NI: QQ 12 34 56 C\n\nPlease contact Mr Amina Rahman',
    )
    await expect(extractDocumentText('pdf', source)).resolves.toContain(
      'amina.rahman@example.test',
    )
    expect(source).toEqual(fixture)
  })

  it('normalises per-character PDF spacing before UK supplement detection', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-spaced-pii-fixture.pdf',
    )
    const text = await extractDocumentText('pdf', fixture)
    expect(text).toContain('QQ123456C')
    expect(text).toContain('amina@example.test')
    expect(text).toContain('I am a QC')
    expect(supplementSpans(text)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'national_insurance',
          text: 'QQ123456C',
        }),
        expect.objectContaining({
          category: 'email',
          text: 'amina@example.test',
        }),
      ]),
    )
  })

  it('allows a short one-page text-layer PDF', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-short-text-layer-fixture.pdf',
    )
    await expect(extractDocumentText('pdf', fixture)).resolves.toBe(
      'Brief note.',
    )
  })

  it('rejects scanned-like PDFs with no text, sparse multi-page text, or zero-width padding', async () => {
    const emptyFixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const lowTextFixture = await readFile(
      '../../data/evals/redact/pdf-low-text-multipage-fixture.pdf',
    )
    const zeroWidthFixture = await readFile(
      '../../data/evals/redact/pdf-zero-width-scanned-fixture.pdf',
    )
    for (const fixture of [emptyFixture, lowTextFixture, zeroWidthFixture])
      await expect(extractDocumentText('pdf', fixture)).rejects.toThrow(
        'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
      )
  })

  it('preserves successful extraction when PDF cleanup fails', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-short-text-layer-fixture.pdf',
    )
    const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
    const pdf = await actual.getDocumentProxy(new Uint8Array(fixture))
    vi.spyOn(pdf, 'destroy').mockRejectedValue(new Error('cleanup failed'))
    unpdf.getDocumentProxy.mockResolvedValue(pdf)

    await expect(extractDocumentText('pdf', fixture)).resolves.toBe(
      'Brief note.',
    )
  })

  it('preserves the scanned-PDF error when PDF cleanup fails', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
    const pdf = await actual.getDocumentProxy(new Uint8Array(fixture))
    vi.spyOn(pdf, 'destroy').mockRejectedValue(new Error('cleanup failed'))
    unpdf.getDocumentProxy.mockResolvedValue(pdf)

    await expect(extractDocumentText('pdf', fixture)).rejects.toThrow(
      'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
    )
  })

  it('turns corrupt DOCX bytes into a deliberate extraction error', async () => {
    await expect(
      extractDocumentText('docx', Buffer.from('not a docx')),
    ).rejects.toBeInstanceOf(DocumentExtractionError)
  })

  it('preserves TXT content', async () => {
    await expect(
      extractDocumentText('txt', Buffer.from('No PII here.')),
    ).resolves.toBe('No PII here.')
  })
})
