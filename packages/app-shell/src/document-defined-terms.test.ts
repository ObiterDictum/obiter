import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { checkDefinedTerms } from './document-defined-terms'
import { partitionDraftState } from './document-save-partition'
import { emptyDraftState } from './document-save-plan'
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
        marked: 'Hourly Rate',
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

  it('flags a pending mark whose covered text drifted after it was made', () => {
    // The mark bound 'Hourly Rate' at [4,15); a typed draft has since
    // changed what that range covers. The finding names the term, not the
    // text now under it — and the save partition must not emit the op.
    const structures: StructuralDraft[] = [
      {
        id: 'd1',
        kind: 'defined-term',
        paragraphId: 'p1',
        from: 4,
        to: 15,
        marked: 'Hourly Rate',
      },
    ]
    const check = checkDefinedTerms(
      model(paragraph('p1', 'The Hourly Rate applies.')),
      structures,
      [],
      new Set(),
      { 'p1-r1': 'The Weekly Rate applies.' },
      noDrafts.extraRuns,
    )
    expect(check.terms).toEqual([
      { term: 'hourly rate', marks: 1, uses: 0, paragraphId: 'p1' },
    ])
    expect(check.findings).toEqual([
      expect.objectContaining({
        pending: true,
        severity: 'issue',
        message: expect.stringContaining('will not be saved'),
      }),
    ])
  })

  it('blocks the save when text under the range no longer reads the term', () => {
    const draft: StructuralDraft = {
      id: 'd1',
      kind: 'defined-term',
      paragraphId: 'p1',
      from: 4,
      to: 15,
      marked: 'Hourly Rate',
    }
    const partition = partitionDraftState(
      model(paragraph('p1', 'The Hourly Rate applies.')),
      {
        ...emptyDraftState(),
        // Typing earlier in the paragraph shifted the range's contents.
        drafts: { 'p1-r1': 'See the Hourly Rate applies.' },
        structures: [draft],
      },
    )
    expect(partition.keep.structures).toEqual([])
    expect(partition.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(partition.blocked[0]?.reason).toBe(
      'The text under this defined-term mark changed since it was marked.',
    )
  })

  it('keeps the mark when a draft only changes text outside the range', () => {
    const draft: StructuralDraft = {
      id: 'd1',
      kind: 'defined-term',
      paragraphId: 'p1',
      from: 4,
      to: 15,
      marked: 'Hourly Rate',
    }
    const partition = partitionDraftState(
      model(paragraph('p1', 'The Hourly Rate applies.')),
      {
        ...emptyDraftState(),
        drafts: { 'p1-r1': 'The Hourly Rate applies always.' },
        structures: [draft],
      },
    )
    expect(partition.keep.structures).toEqual([draft])
    expect(partition.blocked).toEqual([])
  })

  it('blocks the save when the range itself was edited', () => {
    const draft: StructuralDraft = {
      id: 'd1',
      kind: 'defined-term',
      paragraphId: 'p1',
      from: 4,
      to: 15,
      marked: 'Hourly Rate',
    }
    const partition = partitionDraftState(
      model(paragraph('p1', 'The Hourly Rate applies.')),
      {
        ...emptyDraftState(),
        drafts: { 'p1-r1': 'The Monthly Rate applies.' },
        structures: [draft],
      },
    )
    expect(partition.keep.structures).toEqual([])
    expect(partition.blocked[0]?.reason).toBe(
      'The text under this defined-term mark changed since it was marked.',
    )
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
