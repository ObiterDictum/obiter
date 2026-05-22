import { describe, expect, it } from 'vitest'
import { atlasAuthoritySchema, atlasParagraphSchema } from './index'

describe('Atlas legal schemas', () => {
  it('validates authority records with paragraphs', () => {
    const authority = atlasAuthoritySchema.parse({
      id: 'uksc-2024-1',
      title: 'Test Authority',
      neutralCitation: '[2024] UKSC 1',
      court: 'uksc',
      jurisdiction: 'england-and-wales',
      dateDecided: '2024-01-17',
      sourceType: 'judgment',
      sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2024-001.html',
      paragraphs: [
        {
          id: 'uksc-2024-1-p1',
          documentId: 'uksc-2024-1',
          paragraphNumber: 1,
          text: 'The appeal concerns a public law issue.',
        },
      ],
    })

    expect(authority.neutralCitation).toBe('[2024] UKSC 1')
    expect(authority.paragraphs).toHaveLength(1)
  })

  it('rejects malformed authority and paragraph records', () => {
    expect(() =>
      atlasAuthoritySchema.parse({
        id: '',
        title: 'Broken Authority',
        neutralCitation: '[2024] UKSC 1',
        court: 'uksc',
        jurisdiction: 'england-and-wales',
        dateDecided: '17 January 2024',
        sourceType: 'judgment',
        sourceUrl: 'not a url',
      }),
    ).toThrow()

    expect(() =>
      atlasParagraphSchema.parse({
        id: 'p1',
        documentId: 'doc1',
        paragraphNumber: 0,
        text: '',
      }),
    ).toThrow()
  })
})
