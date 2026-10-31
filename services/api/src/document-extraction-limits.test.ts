import { describe, expect, it } from 'bun:test'

import {
  DocumentExtractionError,
  documentTextTooLongMessage,
  extractedTextWithinLimit,
  MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH,
} from './document-extraction-limits'

describe('DocumentExtractionError', () => {
  it('keeps a wrapped extraction failure off the client by default', () => {
    const error = new DocumentExtractionError('synthetic parser internals')

    expect(error.userFacing).toBe(false)
  })
})

describe('extracted document text limit', () => {
  it('accepts text exactly at the limit and refuses one character more', () => {
    const atLimit = 'x'.repeat(MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH)

    expect(extractedTextWithinLimit(atLimit)).toBe(true)
    expect(extractedTextWithinLimit(`${atLimit}x`)).toBe(false)
  })

  it('names the actual length, the limit and the remedy in the refusal', () => {
    const message = documentTextTooLongMessage(
      MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH + 1,
    )

    expect(message).toContain('2,000,001 characters')
    expect(message).toContain('up to 2,000,000 characters')
    expect(message).toContain('Split it into smaller documents')
  })
})
