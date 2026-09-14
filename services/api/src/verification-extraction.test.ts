import { describe, expect, it } from 'vitest'
import type { DocumentModelWire, DocumentStoryKind } from '@obiter/contracts'
import { extractVerificationCandidates } from './verification-extraction'

function paragraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r1`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function story(kind: DocumentStoryKind, partName: string, texts: string[]) {
  return {
    partName,
    kind,
    paragraphs: texts.map((text, index) => paragraph(`p${index + 1}`, text)),
    preservedXmlFragments: [],
  }
}

function model(text: string): DocumentModelWire {
  return {
    version: 1,
    stories: [story('document', 'word/document.xml', [text])],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function modelWith(stories: DocumentModelWire['stories']): DocumentModelWire {
  return {
    version: 1,
    stories,
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

describe('extractVerificationCandidates', () => {
  it('extracts a case citation, a legislation path, and a quote with offsets', () => {
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
    // Two citations could own this quotation, so the conservative policy
    // refuses to choose one.
    expect(quote?.attributedCitationId).toBeNull()
    expect(quote?.attribution).toBe('ambiguous')
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
    expect(extracted.quotes[0]?.attribution).toBe('none')
  })

  it('uses UTF-16 offsets that match the stored paragraph slice', () => {
    const text = 'See [2024] UKSC 1.'
    const extracted = extractVerificationCandidates(model(text))
    const citation = extracted.citations[0]
    expect(citation).toBeDefined()
    expect(text.slice(citation!.start, citation!.end)).toBe(citation!.rawText)
  })

  it('extracts citations from the document, footnote and endnote stories', () => {
    const extracted = extractVerificationCandidates(
      modelWith([
        story('document', 'word/document.xml', ['Main cites [2024] UKSC 1.']),
        story('footnotes', 'word/footnotes.xml', [
          'A footnote cites /ln/ukpga/1998/42/section/6.',
        ]),
        story('endnotes', 'word/endnotes.xml', [
          'An endnote cites [2023] UKSC 2.',
        ]),
      ]),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '[2024] UKSC 1',
      '/ln/ukpga/1998/42/section/6',
      '[2023] UKSC 2',
    ])
    expect(extracted.citations.map((item) => item.storyKind)).toEqual([
      'document',
      'footnotes',
      'endnotes',
    ])
    expect(extracted.citations.map((item) => item.locationParagraphId)).toEqual(
      [
        'document\u001fword/document.xml\u001fp1',
        'footnotes\u001fword/footnotes.xml\u001fp1',
        'endnotes\u001fword/endnotes.xml\u001fp1',
      ],
    )
  })

  it('keeps paragraph ids from different stories from colliding', () => {
    const extracted = extractVerificationCandidates(
      modelWith([
        story('document', 'word/document.xml', ['Main [2024] UKSC 1.']),
        story('footnotes', 'word/footnotes.xml', ['Note [2024] UKSC 1.']),
      ]),
    )
    const ids = extracted.citations.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('orders stories and paragraphs deterministically across reruns', () => {
    const build = () =>
      extractVerificationCandidates(
        modelWith([
          story('endnotes', 'word/endnotes.xml', ['End [2023] UKSC 2.']),
          story('document', 'word/document.xml', ['Main [2024] UKSC 1.']),
          story('footnotes', 'word/footnotes.xml', ['Note [2022] UKSC 3.']),
        ]),
      )
    expect(build()).toEqual(build())
    expect(build().citations.map((item) => item.storyKind)).toEqual([
      'document',
      'footnotes',
      'endnotes',
    ])
  })

  it('ignores stories that are deliberately out of scope', () => {
    const extracted = extractVerificationCandidates(
      modelWith([
        story('document', 'word/document.xml', ['Main [2024] UKSC 1.']),
        story('header', 'word/header1.xml', ['Header [2024] UKSC 9.']),
        story('footer', 'word/footer1.xml', ['Footer [2024] UKSC 8.']),
        story('comments', 'word/comments.xml', ['Comment [2024] UKSC 7.']),
      ]),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '[2024] UKSC 1',
    ])
    expect(extracted.skippedStoryKinds).toEqual([
      'comments',
      'footer',
      'header',
    ])
  })

  it('records an empty or malformed in-scope story rather than dropping it', () => {
    const extracted = extractVerificationCandidates(
      modelWith([
        story('document', 'word/document.xml', []),
        {
          partName: 'word/footnotes.xml',
          kind: 'footnotes',
          paragraphs: [
            {
              id: 'p1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ]),
    )
    expect(extracted.citations).toEqual([])
    expect(extracted.checkedStories.map((item) => item.partName)).toEqual([
      'word/document.xml',
      'word/footnotes.xml',
    ])
    expect(extracted.checkedStories[0]?.paragraphCount).toBe(0)
    expect(extracted.skippedStoryKinds).toEqual([])
  })

  it('does not shrink a malformed legislation path into another Act', () => {
    const extracted = extractVerificationCandidates(
      model('See /ln/ukpga/1998/42x for the provision.'),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '/ln/ukpga/1998/42x',
    ])
  })

  it('extracts one bounded token and lets V3 decide every attack suffix', () => {
    const attacks: Array<[string, string]> = [
      ['/ln/ukpga/1998/42x', '/ln/ukpga/1998/42x'],
      ['/ln/ukpga/1998/42/section/6x', '/ln/ukpga/1998/42/section/6x'],
      ['/ln/ukpga/1998/42/section/6.', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6,', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6;', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6:', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6)', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6“', '/ln/ukpga/1998/42/section/6'],
      ['/ln/ukpga/1998/42/section/6..', '/ln/ukpga/1998/42/section/6..'],
      ['/ln/ukpga/1998/42?section=6', '/ln/ukpga/1998/42?section=6'],
      ['/ln/ukpga/1998/42#frag', '/ln/ukpga/1998/42#frag'],
      ['/ln/ukpga/1998/%34%32/section/6', '/ln/ukpga/1998/%34%32/section/6'],
    ]
    for (const [text, expected] of attacks) {
      const extracted = extractVerificationCandidates(
        model(`Cite ${text} now.`),
      )
      expect(extracted.citations.map((item) => item.rawText)).toEqual([
        expected,
      ])
    }
  })

  it('resolves a path followed by prose and two paths in one paragraph', () => {
    const extracted = extractVerificationCandidates(
      model(
        'See /ln/ukpga/1998/42/section/6 and /ln/ukpga/2010/15/schedule/2/paragraph/4 for detail.',
      ),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '/ln/ukpga/1998/42/section/6',
      '/ln/ukpga/2010/15/schedule/2/paragraph/4',
    ])
  })

  it('keeps a malformed suffix before a valid later citation malformed', () => {
    const extracted = extractVerificationCandidates(
      model('First /ln/ukpga/1998/42x then /ln/ukpga/1998/42/section/6.'),
    )
    expect(extracted.citations.map((item) => item.rawText)).toEqual([
      '/ln/ukpga/1998/42x',
      '/ln/ukpga/1998/42/section/6',
    ])
  })

  it('refuses to attribute a quote when several citations could own it', () => {
    const extracted = extractVerificationCandidates(
      model('“the court must consider” [2024] UKSC 1 [2023] UKSC 2'),
    )
    expect(extracted.quotes[0]?.attributedCitationId).toBeNull()
    expect(extracted.quotes[0]?.attribution).toBe('ambiguous')
  })

  it('refuses a citation on each side of a quote', () => {
    const extracted = extractVerificationCandidates(
      model('[2024] UKSC 1 “the court must consider” [2023] UKSC 2'),
    )
    expect(extracted.quotes[0]?.attributedCitationId).toBeNull()
    expect(extracted.quotes[0]?.attribution).toBe('ambiguous')
  })

  it('refuses to reuse one citation for several quotations', () => {
    const extracted = extractVerificationCandidates(
      model('“first quotation” “second quotation” [2024] UKSC 1'),
    )
    expect(extracted.quotes).toHaveLength(2)
    expect(
      extracted.quotes.every((quote) => quote.attribution === 'ambiguous'),
    ).toBe(true)
  })

  it('attributes when exactly one citation is defensible', () => {
    const extracted = extractVerificationCandidates(
      model('“the court must consider” [2024] UKSC 1'),
    )
    expect(extracted.quotes[0]?.attribution).toBe('attributed')
    expect(extracted.quotes[0]?.attributedCitationId).toBe(
      extracted.citations[0]?.id,
    )
  })

  it('does not attribute a quotation to a citation in another story', () => {
    const extracted = extractVerificationCandidates(
      modelWith([
        story('document', 'word/document.xml', ['“a quotation here”']),
        story('footnotes', 'word/footnotes.xml', ['[2024] UKSC 1']),
      ]),
    )
    expect(extracted.quotes[0]?.attribution).toBe('none')
  })
})
