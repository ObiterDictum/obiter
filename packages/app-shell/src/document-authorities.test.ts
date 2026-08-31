import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { extractAuthorities } from './document-authorities'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [
            {
              id: 'r1',
              text: 'See [2024] UKSC 3 and [2023] EWCA Civ 12.',
              preservedXmlFragments: [],
            },
          ],
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

describe('extractAuthorities', () => {
  it('extracts UK and E&W neutral citations and ignores other brackets', () => {
    expect(extractAuthorities(model, {}, [], [])).toEqual([
      {
        paragraphId: 'p1',
        start: 4,
        end: 17,
        citation: '[2024] UKSC 3',
      },
      {
        paragraphId: 'p1',
        start: 22,
        end: 40,
        citation: '[2023] EWCA Civ 12',
      },
    ])
    const noisy: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...model.stories[0],
          paragraphs: [
            {
              id: 'p1',
              runs: [
                {
                  id: 'r1',
                  text: 'CPR [2024] 12 and an exhibit [A].',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
        },
      ],
    }
    expect(extractAuthorities(noisy, {}, [], [])).toEqual([])
  })
})
