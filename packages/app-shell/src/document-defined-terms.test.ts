import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { checkDefinedTerms } from './document-defined-terms'
import type { StructuralDraft } from './document-structural-drafts'

function paragraph(
  id: string,
  text: string,
  fragments: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r1`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: fragments,
  }
}

function model(...paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
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
}

const noDrafts = {
  drafts: {},
  extraRuns: {},
}

function mark(id: number, name: string) {
  return [
    `<w:bookmarkStart w:id="${String(id)}" w:name="${name}"/>`,
    `<w:bookmarkEnd w:id="${String(id)}"/>`,
  ]
}

describe('checkDefinedTerms', () => {
  it('reports a clean marked term with its use count', () => {
    const check = checkDefinedTerms(
      model(
        paragraph(
          'p1',
          'In this agreement, "Hourly Rate" means £150 per hour.',
          mark(3, '_Def_hourly_rate'),
        ),
        paragraph('p2', 'The Hourly Rate applies to all work.'),
      ),
      [],
      [],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.terms).toEqual([
      { term: 'hourly rate', marks: 1, uses: 1, paragraphId: 'p1' },
    ])
    expect(check.findings).toEqual([])
  })

  it('flags a duplicate definition and use before the defining paragraph', () => {
    const check = checkDefinedTerms(
      model(
        paragraph('p1', 'The Supplier provides the Services.'),
        paragraph(
          'p2',
          '"Supplier" means the first company.',
          mark(1, '_Def_supplier'),
        ),
        paragraph(
          'p3',
          'and "Supplier" also means the second company.',
          mark(2, '_Def_supplier'),
        ),
      ),
      [],
      [],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'issue',
          message: expect.stringContaining('marked 2 times'),
        }),
        expect.objectContaining({
          paragraphId: 'p1',
          severity: 'review',
          message: expect.stringContaining('used before'),
        }),
      ]),
    )
  })

  it('flags an unpaired mark and a malformed _Def_ name', () => {
    const check = checkDefinedTerms(
      model(
        paragraph('p1', 'Text.', [
          '<w:bookmarkStart w:id="7" w:name="_Def_term"/>',
          '<w:bookmarkStart w:id="8" w:name="_Def_!!"/>',
        ]),
      ),
      [],
      [],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'issue',
          message: expect.stringContaining('without a matching end'),
        }),
        expect.objectContaining({
          severity: 'review',
          message: expect.stringContaining('does not decode'),
        }),
      ]),
    )
  })

  it('flags a mark whose covered text changed', () => {
    const check = checkDefinedTerms(
      model(
        paragraph('p1', 'The retainer is due.', mark(1, '_Def_hourly_rate')),
      ),
      [],
      [],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'review',
          message: expect.stringContaining('no longer reads as the term'),
        }),
      ]),
    )
  })

  it('flags a quoted capitalised phrase that looks unmarked', () => {
    const check = checkDefinedTerms(
      model(paragraph('p1', 'The "Consultancy Fee" is payable monthly.')),
      [],
      [],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.findings).toEqual([
      expect.objectContaining({
        paragraphId: 'p1',
        severity: 'review',
        message: expect.stringContaining('not marked'),
      }),
    ])
  })

  it('counts pending marks and ignores the deleted paragraph', () => {
    const structures: StructuralDraft[] = [
      {
        id: 'd1',
        kind: 'defined-term',
        paragraphId: 'p1',
        from: 4,
        to: 15,
      },
    ]
    // p1 'The Hourly Rate applies.' [4,15) covers 'Hourly Rate'
    const check = checkDefinedTerms(
      model(
        paragraph('p1', 'The Hourly Rate applies.'),
        paragraph('p2', 'An Hourly Rate mention in a deleted paragraph.'),
      ),
      structures,
      [],
      new Set(['p2']),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.terms).toEqual([
      { term: 'hourly rate', marks: 1, uses: 0, paragraphId: 'p1' },
    ])
    expect(check.findings).toEqual([])
  })

  it('reads a pending insert paragraph in flow order', () => {
    const check = checkDefinedTerms(
      model(
        paragraph('p1', 'The Supplier provides Services.'),
        paragraph('p2', '"Supplier" means Alice.', mark(1, '_Def_supplier')),
      ),
      [],
      [
        {
          clientId: 'new-1',
          afterParagraphId: 'p2',
          beforeParagraphId: 'p1',
          text: 'Supplier Ltd.',
        },
      ],
      new Set(),
      noDrafts.drafts,
      noDrafts.extraRuns,
    )
    expect(check.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'review',
          message: expect.stringContaining('used before'),
        }),
      ]),
    )
  })
})
