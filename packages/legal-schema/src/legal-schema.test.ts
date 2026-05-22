import { describe, expect, it } from 'vitest'
import {
  atlasAuthoritySchema,
  atlasAuthoritySummarySchema,
  atlasParagraphSchema,
} from './index'

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

  it('validates summary records without paragraph text', () => {
    const summary = atlasAuthoritySummarySchema.parse({
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
          text: 'This text must not be returned in search summaries.',
        },
      ],
    })

    expect(summary).not.toHaveProperty('paragraphs')
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

  it('rejects legislation records until a legislation-specific schema exists', () => {
    expect(() =>
      atlasAuthoritySchema.parse({
        id: 'ukpga-1977-37',
        title: 'Patents Act 1977',
        neutralCitation: '1977 c. 37',
        court: 'uk-parliament',
        jurisdiction: 'united-kingdom',
        dateDecided: '1977-07-29',
        sourceType: 'legislation',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/1977/37/contents',
      }),
    ).toThrow()
  })
})
