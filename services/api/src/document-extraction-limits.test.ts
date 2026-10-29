import { describe, expect, it } from 'bun:test'

import { DocumentExtractionError } from './document-extraction-limits'

describe('DocumentExtractionError', () => {
  it('keeps a wrapped extraction failure off the client by default', () => {
    const error = new DocumentExtractionError('synthetic parser internals')

    expect(error.userFacing).toBe(false)
  })
})
