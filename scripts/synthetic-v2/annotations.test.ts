import { describe, expect, it } from 'vitest'
import { parseAnnotationResponse, sourceTokens } from './annotations'

describe('structured annotation responses', () => {
  it('constructs exact UTF-16 spans from immutable token ranges', () => {
    expect(
      sourceTokens('Dear Zoë Patel.').map(({ index, text }) => ({
        index,
        text,
      })),
    ).toEqual([
      { index: 0, text: 'Dear' },
      { index: 1, text: 'Zoë' },
      { index: 2, text: 'Patel' },
      { index: 3, text: '.' },
    ])
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              startToken: 1,
              endToken: 3,
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

  it('selects repeated mentions without model-supplied occurrence counts', () => {
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              startToken: 4,
              endToken: 6,
            },
          ],
        }),
        'Ms Patel spoke. Ms Patel agreed.',
        'doc-1',
      ),
    ).toEqual([
      { category: 'person_private', start: 16, end: 24, text: 'Ms Patel' },
    ])
  })

  it('rejects invalid token ranges', () => {
    expect(() =>
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              startToken: 0,
              endToken: 99,
            },
          ],
        }),
        'Ms Patel spoke.',
        'doc-1',
      ),
    ).toThrow('valid token range')
  })

  it('canonicalizes nested and conflicting labels for one person mention', () => {
    expect(
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            {
              category: 'person_private',
              startToken: 0,
              endToken: 3,
            },
            {
              category: 'person_protected',
              startToken: 1,
              endToken: 3,
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

  it('rejects malformed or non-person overlaps', () => {
    expect(() =>
      parseAnnotationResponse(
        JSON.stringify({
          id: 'doc-1',
          spans: [
            { category: 'url', startToken: 1, endToken: 6 },
            { category: 'url', startToken: 3, endToken: 6 },
          ],
        }),
        'Visit https://example.test.',
        'doc-1',
      ),
    ).toThrow('Overlapping or nested spans')
    expect(() => parseAnnotationResponse('{}', 'Alice', 'doc-1')).toThrow()
  })
})
