import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { extractVerificationCandidates } from './verification-extraction'

function model(text: string): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [{ id: 'r1', text, preservedXmlFragments: [] }],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

describe('extractVerificationCandidates', () => {
  it('extracts a case citation, a legislation path, and an attributed quote', () => {
    const extracted = extractVerificationCandidates(
      model(
        'The court said “the court must consider” [2024] UKSC 1 and /ln/ukpga/1998/42/section/6.',
      ),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '[2024] UKSC 1',
      '/ln/ukpga/1998/42/section/6',
    ])
    const quote = extracted.quotes[0]
    expect(quote?.rawText).toBe('the court must consider')
    expect(quote?.attributedCitationId).toBe(extracted.citations[0]?.id)
    expect(
      'The court said “the court must consider” [2024] UKSC 1 and /ln/ukpga/1998/42/section/6.'.slice(
        quote!.start,
        quote!.end,
      ),
    ).toBe(quote!.rawText)
  })

  it('leaves a quotation without a same-paragraph citation unattributed', () => {
    const extracted = extractVerificationCandidates(
      model('A draft said "no authority here".'),
    )
    expect(extracted.citations).toEqual([])
    expect(extracted.quotes[0]?.attributedCitationId).toBeNull()
  })

  it('uses UTF-16 offsets that match the stored paragraph slice', () => {
    const text = 'See [2024] UKSC 1.'
    const extracted = extractVerificationCandidates(model(text))
    const citation = extracted.citations[0]
    expect(citation).toBeDefined()
    expect(text.slice(citation!.start, citation!.end)).toBe(citation!.rawText)
  })
})
