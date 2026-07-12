import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { DocumentExtractionError, extractDocumentText } from './document-extraction'

describe('extractDocumentText', () => {
  it('extracts text from the checked-in DOCX demo fixture', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    await expect(extractDocumentText('docx', fixture)).resolves.toContain('Mr James Cartwright')
  })

  it('turns corrupt DOCX bytes into a deliberate extraction error', async () => {
    await expect(extractDocumentText('docx', Buffer.from('not a docx'))).rejects.toBeInstanceOf(DocumentExtractionError)
  })

  it('preserves TXT content', async () => {
    await expect(extractDocumentText('txt', Buffer.from('No PII here.'))).resolves.toBe('No PII here.')
  })
})
