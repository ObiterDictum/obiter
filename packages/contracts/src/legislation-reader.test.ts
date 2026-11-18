import { describe, expect, it } from 'bun:test'
import { legislationActTextPageSchema } from './legislation-reader'
import { legislationActTextQuerySchema } from './legislation-act-text-query'
import { legislationSearchHitSchema } from './legislation-search-hit'

describe('Act reading contracts', () => {
  it('defaults to the first bounded page and validates URL query strings', () => {
    expect(legislationActTextQuerySchema.parse({})).toEqual({
      offset: 0,
      limit: 24,
    })
    expect(
      legislationActTextQuerySchema.parse({ offset: '240', limit: '50' }),
    ).toEqual({ offset: 240, limit: 50 })
    for (const query of [
      { offset: '-1' },
      { offset: '' },
      { offset: '2147483648' },
      { limit: '51' },
      { limit: '0' },
      { limit: '2.5' },
    ]) {
      expect(legislationActTextQuerySchema.safeParse(query).success).toBe(false)
    }
  })

  it('excludes wording from withheld and repealed entries at the response boundary', () => {
    for (const legislationStatus of ['amended_not_held', 'repealed']) {
      const result = legislationActTextPageSchema.parse({
        entries: [
          {
            labelPath: 'section/1',
            provision: {
              legislationStatus,
              officialUrl:
                'https://www.legislation.gov.uk/ukpga/2025/1/section/1',
              canonicalUrl: '/ln/ukpga/2025/1/section/1',
              notice: 'Read the official record.',
              text: 'Stale wording',
            },
          },
        ],
        nextOffset: null,
      })
      expect(result.entries[0]?.provision).not.toHaveProperty('text')
    }
  })

  it('accepts a legacy Act hit and a new result with reader metadata', () => {
    const hit = {
      id: 'ukpga/2025/1',
      resultGroup: 'legislation' as const,
      legislationStatus: 'current' as const,
      title: 'Example Act 2025',
      provisionLabel: '2025 c. 1',
      labelPath: '',
      documentIdentity: 'ukpga/2025/1',
      extent: 'E+W',
      officialUrl: 'https://www.legislation.gov.uk/ukpga/2025/1',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2025/1',
    }
    expect(legislationSearchHitSchema.parse(hit)).toEqual(hit)
    const summary = {
      status: 'in_force' as const,
      totalCount: 30,
      withheldCount: 1,
      outline: ['Part 1 · Introduction'],
    }
    expect(
      legislationSearchHitSchema.parse({
        ...hit,
        canonicalUrl: '/ln/ukpga/2025/1',
        act: summary,
      }).act,
    ).toEqual(summary)
  })
})
