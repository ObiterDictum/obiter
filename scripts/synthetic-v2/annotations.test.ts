import { describe, expect, it } from 'vitest'
import { parseAnnotationResponse } from './annotations'

describe('structured annotation responses', () => {
  it('validates zero-based UTF-16 offsets against immutable source text', () => {
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              quote: 'Zoë Patel',
              occurrence: 1,
              start: 5,
              end: 14,
            },
          ],
        }),
        'Dear Zoë Patel.',
        'doc-1',
      ),
    ).toEqual([
      { category: 'person_private', start: 5, end: 14, text: 'Zoë Patel' },
    ])
  })

  it('rejects rewritten, malformed, or overlapping annotation payloads', () => {
    expect(() => parseAnnotationResponse('{}', 'Alice', 'doc-1')).toThrow()
    expect(() =>
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'email',
              quote: 'Alice',
              occurrence: 1,
              start: 0,
              end: 99,
            },
          ],
        }),
        'Alice',
        'doc-1',
      ),
    ).toThrow()
  })
})
