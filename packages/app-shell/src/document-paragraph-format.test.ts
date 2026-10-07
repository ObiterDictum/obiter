import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  collectFormatOperations,
  documentFormatToolbar,
  emptyFormatDrafts,
  formattedModel,
  setParagraphFormatDraft,
} from './document-format-edits'
import {
  DEFAULT_INDENT_TWIPS,
  indentationPatch,
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
    comments: [],
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

  it('clears only the special indent for None, preserving left and right', () => {
    const bothSides = modelWith([
      paragraph(
        'p1',
        '<w:pPr><w:ind w:left="720" w:right="360" w:firstLine="720"/></w:pPr>',
      ),
    ])
    const released =
      formattedModel(
        bothSides,
        setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
          indentation: indentationPatch('none'),
        }),
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    expect(released).toContain('w:left="720"')
    expect(released).toContain('w:right="360"')
    expect(released).not.toMatch(/w:(firstLine|hanging)=/u)
  })

  it('removes an empty ind element when None clears the only indent', () => {
    const specialOnly = modelWith([
      paragraph('p1', '<w:pPr><w:ind w:firstLine="720"/></w:pPr>'),
    ])
    const released =
      formattedModel(
        specialOnly,
        setParagraphFormatDraft(emptyFormatDrafts, 'p1', {
          indentation: indentationPatch('none'),
        }),
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    expect(released).not.toMatch(/<w:ind\b/u)
  })
})

describe('indentation None no-op', () => {
  // A paragraph whose only direct indent is left/right has no special indent
  // for None to clear, so None must not draft, record history, or save.
  const leftOnly = modelWith([
    paragraph('p1', '<w:pPr><w:ind w:left="720"/></w:pPr>'),
  ])

  function toolbarWith(model: DocumentModelWire) {
    let format = emptyFormatDrafts
    let historySteps = 0
    const toolbar = documentFormatToolbar(model, format, 'p1', (update) => {
      const next = update(format)
      if (next !== format) historySteps += 1
      format = next
    })
    return {
      historySteps: () => historySteps,
      format: () => format,
      toolbar,
    }
  }

  it('does not draft, record history, or emit an operation', () => {
    const state = toolbarWith(leftOnly)
    state.toolbar.onIndentKind('none')
    expect(state.format()).toBe(emptyFormatDrafts)
    expect(state.historySteps()).toBe(0)
    expect(collectFormatOperations(leftOnly, state.format(), [])).toEqual([])
  })

  it('replaces a pending special indent with the clear', () => {
    const state = toolbarWith(leftOnly)
    state.toolbar.onIndentKind('first')
    expect(state.format().paragraphFormats.p1).toEqual({
      indentation: { firstLine: 720 },
    })
    state.toolbar.onIndentKind('none')
    expect(state.format().paragraphFormats.p1).toEqual({
      indentation: { firstLine: null, hanging: null },
    })
  })
})

describe('hanging indent body anchor', () => {
  function toolbarWith(model: DocumentModelWire) {
    let format = emptyFormatDrafts
    const toolbar = documentFormatToolbar(model, format, 'p1', (update) => {
      format = update(format)
    })
    return { format: () => format, toolbar }
  }

  it('adds the default half-inch left indent to an unindented paragraph', () => {
    const state = toolbarWith(plain)
    state.toolbar.onIndentKind('hanging')
    expect(state.format().paragraphFormats.p1).toEqual({
      indentation: {
        left: DEFAULT_INDENT_TWIPS,
        hanging: DEFAULT_INDENT_TWIPS,
      },
    })
    const xml =
      formattedModel(
        plain,
        state.format(),
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    expect(xml).toContain(`w:left="${String(DEFAULT_INDENT_TWIPS)}"`)
    expect(xml).toContain(`w:hanging="${String(DEFAULT_INDENT_TWIPS)}"`)
  })

  it('keeps a larger existing left indent', () => {
    const wide = modelWith([
      paragraph('p1', '<w:pPr><w:ind w:left="1440"/></w:pPr>'),
    ])
    const state = toolbarWith(wide)
    state.toolbar.onIndentKind('hanging')
    expect(state.format().paragraphFormats.p1).toEqual({
      indentation: { left: 1440, hanging: DEFAULT_INDENT_TWIPS },
    })
  })
})

describe('paragraph layout on a pending insert', () => {
  // A pending insert is not a stored paragraph: its layout cannot be sent as
  // its own operation, so a control acting on it would only leave a draft that
  // never paints and blocks the save.
  function toolbarFor(paragraphId: string, model: DocumentModelWire = plain) {
    let format = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      model,
      format,
      paragraphId,
      (update) => {
        format = update(format)
      },
    )
    return { format: () => format, toolbar }
  }

  it('does not draft layout for a caret in a pending insert', () => {
    const state = toolbarFor('insert-1')
    state.toolbar.onAlignment('center')
    state.toolbar.onLineSpacing('1.5')
    state.toolbar.onIndentKind('hanging')
    expect(state.format()).toBe(emptyFormatDrafts)
  })

  it('formats only the stored paragraphs of a mixed selection', () => {
    let format = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      plain,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      {
        kind: 'selection',
        ranges: [
          { paragraphId: 'p1', from: 0, to: 0 },
          { paragraphId: 'insert-1', from: 0, to: 0 },
        ],
      },
    )
    toolbar.onAlignment('center')
    expect(format.paragraphFormats).toEqual({ p1: { alignment: 'center' } })
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
