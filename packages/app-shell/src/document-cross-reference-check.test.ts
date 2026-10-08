import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { checkCrossReferences } from './document-cross-reference-check'
import type { StructuralDraft } from './document-structural-drafts'

function run(
  id: string,
  text: string,
  fragments: string[] = [],
): DocumentTextRunWire {
  return { id, text, preservedXmlFragments: fragments }
}

function paragraph(
  id: string,
  runs: DocumentTextRunWire[],
  fragments: string[] = [],
): DocumentParagraphWire {
  return { id, runs, preservedXmlFragments: fragments }
}

function textParagraph(id: string, text: string, fragments: string[] = []) {
  return paragraph(id, [run(`${id}-r1`, text)], fragments)
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

const FIELD_BEGIN = '<w:fldChar w:fldCharType="begin"/>'
const FIELD_SEPARATE = '<w:fldChar w:fldCharType="separate"/>'
const FIELD_END = '<w:fldChar w:fldCharType="end"/>'
const INSTR = '<w:instrText xml:space="preserve"> REF Target1 </w:instrText>'

function fieldParagraph(id: string, resultText: string) {
  return paragraph(id, [
    run(`${id}-r1`, '', [FIELD_BEGIN, INSTR]),
    run(`${id}-r2`, resultText, [FIELD_SEPARATE]),
    run(`${id}-r3`, '', [FIELD_END]),
  ])
}

function instructionField(id: string, instruction: string, resultText: string) {
  return paragraph(id, [
    run(`${id}-r1`, '', [
      FIELD_BEGIN,
      `<w:instrText xml:space="preserve">${instruction}</w:instrText>`,
    ]),
    run(`${id}-r2`, resultText, [FIELD_SEPARATE]),
    run(`${id}-r3`, '', [FIELD_END]),
  ])
}

const bookmark = (id: number, name: string) => [
  `<w:bookmarkStart w:id="${String(id)}" w:name="${name}"/>`,
  `<w:bookmarkEnd w:id="${String(id)}"/>`,
]

describe('checkCrossReferences', () => {
  it('passes a resolved field pointing at a stored bookmark', () => {
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 2.1', bookmark(1, 'Target1')),
        fieldParagraph('p2', 'Clause 2.1'),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([])
  })

  it('flags a reference to a bookmark that does not exist', () => {
    const check = checkCrossReferences(
      model(fieldParagraph('p1', 'Clause 2.1')),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.findings).toEqual([
      expect.objectContaining({
        paragraphId: 'p1',
        severity: 'issue',
        message: expect.stringContaining('not a bookmark'),
      }),
    ])
  })

  it('flags a reference whose target paragraph is marked for deletion', () => {
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 2.1', bookmark(1, 'Target1')),
        fieldParagraph('p2', 'Clause 2.1'),
      ),
      [],
      new Set(['p1']),
      {},
      {},
    )
    expect(check.findings).toEqual([
      expect.objectContaining({
        pending: true,
        severity: 'issue',
        message: expect.stringContaining('marked for deletion'),
      }),
    ])
  })

  it('flags a self-referential field as a review item', () => {
    const check = checkCrossReferences(
      model(
        paragraph('p1', [
          run('p1-r1', 'Clause', [
            '<w:bookmarkStart w:id="3" w:name="Target1"/>',
          ]),
          run('p1-r2', '', ['<w:bookmarkEnd w:id="3"/>', FIELD_BEGIN, INSTR]),
          run('p1-r3', 'Clause', [FIELD_SEPARATE]),
          run('p1-r4', '', [FIELD_END]),
        ]),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.findings).toEqual([
      expect.objectContaining({
        severity: 'review',
        message: expect.stringContaining('its own paragraph'),
      }),
    ])
  })

  it('flags a stale stored result against the target current text', () => {
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 9.9', bookmark(1, 'Target1')),
        fieldParagraph('p2', 'Clause 2.1'),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.findings).toEqual([
      expect.objectContaining({
        severity: 'review',
        message: expect.stringContaining('differs from the target'),
      }),
    ])
  })

  it('passes a REF result the target text still contains', () => {
    // The bookmark need not cover the whole paragraph: a stored result
    // that still appears in the target's text is not stale.
    const check = checkCrossReferences(
      model(
        textParagraph(
          'p1',
          'Clause 2.1 as amended by the later schedule',
          bookmark(1, 'Target1'),
        ),
        fieldParagraph('p2', 'Clause 2.1'),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([])
  })

  it('does not read a PAGEREF or NOTEREF result against the target text', () => {
    // Their stored results are a page number and a note mark — comparing
    // either to paragraph text would invent staleness that is not there.
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 2.1', bookmark(1, 'Target1')),
        instructionField('p2', ' PAGEREF Target1 ', '7'),
        instructionField('p3', ' NOTEREF Target1 ', 'iv'),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(2)
    expect(check.findings).toEqual([])
  })

  it('reads a w:fldSimple reference like a complex field', () => {
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 2.1', bookmark(1, 'Target1')),
        paragraph(
          'p2',
          [],
          [
            '<w:fldSimple w:instr=" REF Target1 "><w:r><w:t>Clause 2.1</w:t></w:r></w:fldSimple>',
          ],
        ),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([])
  })

  it('flags a w:fldSimple reference whose target is missing', () => {
    const check = checkCrossReferences(
      model(
        paragraph(
          'p1',
          [],
          [
            '<w:fldSimple w:instr=" REF Gone "><w:r><w:t>text</w:t></w:r></w:fldSimple>',
          ],
        ),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([
      expect.objectContaining({
        severity: 'issue',
        message: expect.stringContaining('not a bookmark'),
      }),
    ])
  })

  it('checks a REF field nested inside another field', () => {
    // A `REF` inside an `IF`'s result is its own field, closed by its own
    // end — the outer instruction never resolves to the inner target.
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'Clause 2.1', bookmark(1, 'Target1')),
        paragraph('p2', [
          run('p2-r1', '', [FIELD_BEGIN]),
          run('p2-r2', '', [
            '<w:instrText xml:space="preserve"> IF 1 = 1 </w:instrText>',
          ]),
          run('p2-r3', '', [FIELD_BEGIN, INSTR]),
          run('p2-r4', 'Clause 2.1', [FIELD_SEPARATE]),
          run('p2-r5', '', [FIELD_END]),
          run('p2-r6', '', [FIELD_END]),
        ]),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([])
  })

  it('flags a reference instruction that names no target as unread', () => {
    const check = checkCrossReferences(
      model(instructionField('p1', ' REF ', 'text')),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.fields).toBe(1)
    expect(check.findings).toEqual([
      expect.objectContaining({
        severity: 'review',
        message: expect.stringContaining('could not be fully read'),
      }),
    ])
  })

  it('flags an unpaired bookmark half and an open field', () => {
    const check = checkCrossReferences(
      model(
        textParagraph('p1', 'A bookmarked target.', [
          '<w:bookmarkStart w:id="9" w:name="Lone"/>',
        ]),
        paragraph('p2', [
          run('p2-r1', '', [FIELD_BEGIN, INSTR]),
          run('p2-r2', 'partial', [FIELD_SEPARATE]),
        ]),
      ),
      [],
      new Set(),
      {},
      {},
    )
    expect(check.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'issue',
          message: expect.stringContaining('without a matching end'),
        }),
        expect.objectContaining({
          severity: 'review',
          message: expect.stringContaining('could not be fully read'),
        }),
      ]),
    )
  })

  it('flags a pending draft whose target is gone', () => {
    const structures: StructuralDraft[] = [
      {
        id: 's1',
        kind: 'cross-reference',
        paragraphId: 'p2',
        offset: 2,
        targetParagraphId: 'missing',
      },
    ]
    const check = checkCrossReferences(
      model(textParagraph('p1', 'Target.'), textParagraph('p2', 'See .')),
      structures,
      new Set(),
      {},
      {},
    )
    expect(check.pending).toBe(1)
    expect(check.findings).toEqual([
      expect.objectContaining({
        pending: true,
        severity: 'issue',
        message: expect.stringContaining('will not be saved'),
      }),
    ])
  })
})
