import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  classifyAuthorityInput,
  extractAuthorities,
} from './document-authorities'

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
  comments: [],
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

describe('classifyAuthorityInput', () => {
  it.each(['[2024] UKSC 22', '[2023] EWCA Civ 12', '[2024] EWHC 22 (Admin)'])(
    'accepts the supported citation %j as neutral',
    (value) => {
      expect(classifyAuthorityInput(value)).toBe('neutral')
    },
  )

  it.each([
    '[2024] EAT 12',
    '[2024] NICh 3',
    '[2024] ScotCS 7',
    '[2024] Foo 12',
  ])('accepts the unlisted court in %j as unsupported_court', (value) => {
    expect(classifyAuthorityInput(value)).toBe('unsupported_court')
  })

  it.each(['/ln/ukpga/2020/17'])('accepts the legislation path %j', (value) => {
    expect(classifyAuthorityInput(value)).toBe('legislation')
  })

  it('accepts a canonical provision path', () => {
    expect(classifyAuthorityInput('/ln/ukpga/2010/15/section/40')).toBe(
      'legislation',
    )
  })

  it.each([
    '',
    '   ',
    'some free text',
    'the first defendant',
    'Carroll v Taylor [2024] UKSC 22',
    '[2024] UKSC 22 and [2023] EWCA Civ 12',
    '/ln/not-an-id',
    '/ln/ukpga/2010',
    'ukpga/1998/42',
    'ukpga 1998 42',
  ])('rejects %j as invalid', (value) => {
    expect(classifyAuthorityInput(value)).toBe('invalid')
  })
})
