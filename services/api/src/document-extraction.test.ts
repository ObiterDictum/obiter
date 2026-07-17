import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  DocumentExtractionError,
  extractDocumentText,
} from './document-extraction'

describe('extractDocumentText', () => {
  it('extracts text from the checked-in DOCX demo fixture', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    await expect(extractDocumentText('docx', fixture)).resolves.toContain(
      'Mr James Cartwright',
    )
  })

  it('joins text-layer PDF pages and preserves known PII', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-text-layer-fixture.pdf',
    )
    await expect(extractDocumentText('pdf', fixture)).resolves.toContain(
      'NI: QQ 12 34 56 C\n\nPlease contact Mr Amina Rahman',
    )
    await expect(extractDocumentText('pdf', fixture)).resolves.toContain(
      'amina.rahman@example.test',
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

  it('rejects scanned-like PDFs with no text or too little multi-page text', async () => {
    const emptyFixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const lowTextFixture = await readFile(
      '../../data/evals/redact/pdf-low-text-multipage-fixture.pdf',
    )
    for (const fixture of [emptyFixture, lowTextFixture])
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
