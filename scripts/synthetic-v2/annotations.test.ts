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

  it('resolves a unique exact quote even when the model counts entity mentions', () => {
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              quote: 'Ms Patel',
              occurrence: 2,
            },
          ],
        }),
        'Zoë Patel spoke. Ms Patel agreed.',
        'doc-1',
      ),
    ).toEqual([
      { category: 'person_private', start: 17, end: 25, text: 'Ms Patel' },
    ])
  })

  it('rejects an out-of-range occurrence when the exact quote is repeated', () => {
    expect(() =>
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              quote: 'Ms Patel',
              occurrence: 3,
            },
          ],
        }),
        'Ms Patel spoke. Ms Patel agreed.',
        'doc-1',
      ),
    ).toThrow('occurrence is out of range')
  })

  it('canonicalizes nested and conflicting labels for one person mention', () => {
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              quote: 'Ms Zoë Patel',
              occurrence: 1,
            },
            {
              category: 'person_protected',
              quote: 'Zoë Patel',
              occurrence: 1,
            },
          ],
        }),
        'Ms Zoë Patel agreed.',
        'doc-1',
      ),
    ).toEqual([
      {
        category: 'person_protected',
        start: 0,
        end: 12,
        text: 'Ms Zoë Patel',
      },
    ])
  })

  it('rejects rewritten, malformed, or non-person overlaps', () => {
    expect(() =>
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            { category: 'url', quote: 'https://example.test', occurrence: 1 },
            { category: 'url', quote: 'example.test', occurrence: 1 },
          ],
        }),
        'Visit https://example.test.',
        'doc-1',
      ),
    ).toThrow('Overlapping or nested spans')
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
