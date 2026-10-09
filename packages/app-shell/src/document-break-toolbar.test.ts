import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { BreakDraft } from './document-edits'
import { documentBreakToolbar } from './document-break-toolbar'
import { layoutDocument } from './document-page-engine'
import { emptyDraftState, planDocumentSave } from './document-save-plan'

// Review round 5 finding 2: two pending page breaks at the identical paragraph
// offset share the save's overlay key, so only one is written while the
// paginator could paint two. Recording deduplicates the same paragraph, offset
// and kind, so the draft state, the save plan and the paint agree.
//
// Review round 6 finding 2: a section break ignores its offset — it is one
// paragraph-level `w:sectPr` — so two at different offsets on one paragraph
// would paint one section but emit two operations, the second refused. A
// section break therefore deduplicates per paragraph and kind.
describe('break recording', () => {
  it('records one break when a page break is inserted twice at one offset', () => {
    const model = singleParagraphModel()
    const breaks = recordBreaks((at) => {
      at(2).onPageBreak()
      at(2).onPageBreak()
    })
    expect(breaks).toHaveLength(1)

    const plan = planDocumentSave(model, { ...emptyDraftState(), breaks })
    expect(plan.operations).toEqual([
      { type: 'insert_break', paragraphId: 'p1', offset: 2, kind: 'page' },
    ])

    // The paint reads the same canonical set: exactly one break, so the same
    // two-sheet split a single recorded break yields.
    const pages = layoutDocument(model, undefined, [], {}, undefined, breaks)
    const single = layoutDocument(model, undefined, [], {}, undefined, [
      { id: 'only', paragraphId: 'p1', offset: 2, kind: 'page' },
    ])
    expect(pages).toHaveLength(2)
    expect(pages).toHaveLength(single.length)
  })

  it('records one section break when one is inserted at two offsets', () => {
    const model = singleParagraphModel()
    const breaks = recordBreaks((at) => {
      at(1).onSectionBreak()
      at(3).onSectionBreak()
    })
    expect(breaks).toHaveLength(1)

    const plan = planDocumentSave(model, { ...emptyDraftState(), breaks })
    const sectionBreaks = plan.operations.filter(
      (operation) => operation.type === 'insert_section_break',
    )
    expect(sectionBreaks).toEqual([
      { type: 'insert_section_break', paragraphId: 'p1' },
    ])
  })

  it('keeps two page breaks at different offsets distinct', () => {
    const breaks = recordBreaks((at) => {
      at(1).onPageBreak()
      at(3).onPageBreak()
    })
    expect(breaks.map((item) => item.offset)).toEqual([1, 3])
  })

  it('keeps a page break and a section break at one offset distinct', () => {
    const breaks = recordBreaks((at) => {
      at(2).onPageBreak()
      at(2).onSectionBreak()
    })
    expect(breaks.map((item) => item.kind)).toEqual(['page', 'section'])
  })

  it('keeps a page break and a section break at different offsets distinct', () => {
    const breaks = recordBreaks((at) => {
      at(1).onPageBreak()
      at(3).onSectionBreak()
    })
    expect(breaks.map((item) => item.kind)).toEqual(['page', 'section'])
  })

  it('names a margin story, not a pending insert, when the caret is in a header', () => {
    const recorded: BreakDraft[] = []
    const at = (paragraphId: string) =>
      documentBreakToolbar({
        paragraphId,
        model: marginModel(),
        offset: 0,
        selectionActive: false,
        trackChanges: false,
        setBreaks: (update) => {
          recorded.splice(0, recorded.length, ...update(recorded))
        },
      })
    // A stored header paragraph is not pending: the reason matches the
    // structural controls' body-only refusal.
    expect(at('h1').breakUnavailable).toBe(
      'Only the document body can hold this insertion',
    )
    // A genuinely pending id keeps the save-first reason.
    expect(at('pending-1').breakUnavailable).toBe(
      'Save the new paragraph before adding a break',
    )
    at('h1').onPageBreak()
    expect(recorded).toEqual([])
  })

  it('refuses an unresolved caret rather than defaulting to offset zero', () => {
    const recorded: BreakDraft[] = []
    const toolbar = documentBreakToolbar({
      paragraphId: 'p1',
      model: singleParagraphModel(),
      offset: null,
      selectionActive: false,
      trackChanges: false,
      setBreaks: (update) => {
        recorded.splice(0, recorded.length, ...update(recorded))
      },
    })
    expect(toolbar.breakUnavailable).toBe(
      'Place the cursor in the paragraph text to insert a break',
    )
    toolbar.onPageBreak()
    expect(recorded).toEqual([])
  })
})

type BreakToolbarAt = (
  offset: number,
) => ReturnType<typeof documentBreakToolbar>

function recordBreaks(insert: (at: BreakToolbarAt) => void) {
  let breaks: BreakDraft[] = []
  const setBreaks = (update: (current: BreakDraft[]) => BreakDraft[]) => {
    breaks = update(breaks)
  }
  const at: BreakToolbarAt = (offset) =>
    documentBreakToolbar({
      paragraphId: 'p1',
      model: singleParagraphModel(),
      offset,
      selectionActive: false,
      trackChanges: false,
      setBreaks,
    })
  insert(at)
  return breaks
}

function singleParagraphModel(): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [paragraph('p1')],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
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

function paragraph(id: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

/** A body paragraph plus a stored header paragraph the caret can sit in. */
function marginModel(): DocumentModelWire {
  const model = singleParagraphModel()
  return {
    ...model,
    stories: [
      ...model.stories,
      {
        partName: 'word/header1.xml',
        kind: 'header',
        paragraphs: [paragraph('h1')],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
  }
}
