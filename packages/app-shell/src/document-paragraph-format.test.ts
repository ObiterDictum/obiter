import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  collectFormatOperations,
  emptyFormatDrafts,
  formattedModel,
  setParagraphFormatDraft,
} from './document-format-edits'
import {
  paragraphFormatOf,
  paragraphFormatState,
} from './document-paragraph-format'
import {
  clearableSlots,
  emptyDraftState,
  planDocumentSave,
  splitDraftSlots,
  type DraftState,
} from './document-save-plan'

/*
 * E3 paragraph formatting: the draft, the operation it emits, the effective
 * values the controls read back, and the save-plan slot that carries a pending
 * change across a request. The paint is covered by the same `patchParagraphFormatXml`
 * the server writes, so these tests read the model the paint would produce.
 */

function paragraph(id: string, pPr: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [pPr],
  }
}

function modelWith(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
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
  }
}

const plain = modelWith([paragraph('p1', '<w:pPr/>')])

describe('paragraph format draft emission', () => {
  it('emits one set_paragraph_format with only the assigned fields', () => {
    expect(
      collectFormatOperations(
        plain,
        {
          ...emptyFormatDrafts,
          paragraphFormats: {
            p1: {
              alignment: 'center',
              lineSpacing: { line: 360, lineRule: 'auto' },
              indentation: { firstLine: 720 },
            },
          },
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        alignment: 'center',
        lineSpacing: { line: 360, lineRule: 'auto' },
        indentation: { firstLine: 720 },
      },
    ])
  })

  it('emits an explicit null to release a property', () => {
    expect(
      collectFormatOperations(
        plain,
        {
          ...emptyFormatDrafts,
          paragraphFormats: {
            p1: { alignment: null, lineSpacing: null, indentation: null },
          },
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        alignment: null,
        lineSpacing: null,
        indentation: null,
      },
    ])
  })

  it('emits nothing for an empty draft or a deleted paragraph', () => {
    expect(
      collectFormatOperations(
        plain,
        { ...emptyFormatDrafts, paragraphFormats: { p1: {} } },
        [],
      ),
    ).toEqual([])
    expect(
      collectFormatOperations(
        plain,
        {
          ...emptyFormatDrafts,
          paragraphFormats: { p1: { alignment: 'left' } },
        },
        ['p1'],
      ),
    ).toEqual([])
  })

  it('merges fields onto the same paragraph without dropping the others', () => {
    let format = setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
      alignment: 'center',
    })
    format = setParagraphFormatDraft(format, 'p1', {
      lineSpacing: { line: 240 },
    })
    format = setParagraphFormatDraft(format, 'p1', {
      indentation: { hanging: 720 },
    })
    expect(format.paragraphFormats.p1).toEqual({
      alignment: 'center',
      lineSpacing: { line: 240 },
      indentation: { hanging: 720 },
    })
  })
})

describe('effective paragraph format readers', () => {
  it('reads alignment, line spacing and a first-line indent', () => {
    const model = modelWith([
      paragraph(
        'p1',
        '<w:pPr><w:jc w:val="center"/><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:firstLine="720"/></w:pPr>',
      ),
    ])
    expect(paragraphFormatState(model, emptyFormatDrafts, ['p1'])).toEqual({
      alignment: 'center',
      lineSpacing: '1.5',
      indent: 'first',
    })
  })

  it('reads a hanging indent and a plain paragraph', () => {
    const hanging = modelWith([
      paragraph('p1', '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>'),
    ])
    expect(paragraphFormatState(hanging, emptyFormatDrafts, ['p1'])).toEqual({
      alignment: 'left',
      lineSpacing: '',
      indent: 'hanging',
    })
    expect(paragraphFormatState(plain, emptyFormatDrafts, ['p1'])).toEqual({
      alignment: 'left',
      lineSpacing: '',
      indent: 'none',
    })
  })

  it('reports mixed targets as unpressed and blank', () => {
    const model = modelWith([
      paragraph(
        'p1',
        '<w:pPr><w:jc w:val="center"/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="720"/></w:pPr>',
      ),
      paragraph(
        'p2',
        '<w:pPr><w:jc w:val="right"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>',
      ),
    ])
    expect(
      paragraphFormatState(model, emptyFormatDrafts, ['p1', 'p2']),
    ).toEqual({ alignment: null, lineSpacing: '', indent: null })
  })

  it('reads a pending draft over the stored paragraph', () => {
    const format = setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
      alignment: 'right',
      indentation: { hanging: 720 },
    })
    expect(paragraphFormatState(plain, format, ['p1'])).toEqual({
      alignment: 'right',
      lineSpacing: '',
      indent: 'hanging',
    })
  })

  it('reads direct format back in contract form for a reversal', () => {
    expect(
      paragraphFormatOf(
        paragraph(
          'p1',
          '<w:pPr><w:jc w:val="both"/><w:spacing w:line="276" w:lineRule="auto"/><w:ind w:right="360"/></w:pPr>',
        ),
      ),
    ).toEqual({
      alignment: 'both',
      lineSpacing: { line: 276, lineRule: 'auto' },
      indentation: { right: 360 },
    })
  })
})

describe('indentation paint and release', () => {
  const leftIndented = modelWith([
    paragraph('p1', '<w:pPr><w:ind w:left="720"/></w:pPr>'),
  ])

  function painted(format: ReturnType<typeof setParagraphFormatDraft>) {
    return (
      formattedModel(
        leftIndented,
        format,
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    )
  }

  it('preserves a left indent when setting first-line or hanging', () => {
    const firstLine = painted(
      setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
        indentation: { firstLine: 720 },
      }),
    )
    expect(firstLine).toContain('w:left="720"')
    expect(firstLine).toContain('w:firstLine="720"')

    const hanging = painted(
      setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
        indentation: { hanging: 720 },
      }),
    )
    expect(hanging).toContain('w:left="720"')
    expect(hanging).toContain('w:hanging="720"')
  })

  it('releases the whole ind element for None, matching the save writer', () => {
    const released = painted(
      setParagraphFormatDraft(emptyFormatDrafts, 'p1', { indentation: null }),
    )
    expect(released).not.toMatch(/<w:ind\b/u)
  })
})

describe('paragraph format save plan slot', () => {
  it('covers, fingerprints and clears the per-paragraph slot', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyFormatDrafts,
        paragraphFormats: { p1: { alignment: 'center' } },
      },
    }
    const plan = planDocumentSave(plain, state)
    expect(plan.operations).toEqual([
      { type: 'set_paragraph_format', paragraphId: 'p1', alignment: 'center' },
    ])
    expect(plan.covered).toEqual([
      { kind: 'paragraph-format', key: 'pformat:p1', paragraphId: 'p1' },
    ])
    expect(plan.blocked).toEqual([])
    expect(clearableSlots(plan.covered, state, state)).toHaveLength(1)

    // A value edited while the request was in flight is not the value the
    // request sent, so clearing it would drop the newer edit.
    const edited: DraftState = {
      ...state,
      format: {
        ...state.format,
        paragraphFormats: { p1: { alignment: 'right' } },
      },
    }
    expect(clearableSlots(plan.covered, state, edited)).toEqual([])

    const { remaining, removed } = splitDraftSlots(state, plan.covered)
    expect(remaining.format.paragraphFormats).toEqual({})
    expect(removed.format.paragraphFormats).toEqual({
      p1: { alignment: 'center' },
    })
  })

  it('blocks paragraph formatting aimed at a paragraph the model no longer has', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyFormatDrafts,
        paragraphFormats: { gone: { alignment: 'center' } },
      },
    }
    const plan = planDocumentSave(plain, state)
    expect(plan.operations).toEqual([])
    expect(plan.blocked[0]).toMatchObject({
      slot: {
        kind: 'paragraph-format',
        key: 'pformat:gone',
        paragraphId: 'gone',
      },
      label: 'paragraph formatting',
    })
  })
})
