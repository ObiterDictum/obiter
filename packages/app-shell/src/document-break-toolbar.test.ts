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
describe('break recording', () => {
  it('records one break when a page break is inserted twice at one offset', () => {
    const model = singleParagraphModel()
    const breaks = recordBreaks((toolbar) => {
      toolbar.onPageBreak()
      toolbar.onPageBreak()
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

  it('keeps a page break and a section break at one offset distinct', () => {
    const breaks = recordBreaks((toolbar) => {
      toolbar.onPageBreak()
      toolbar.onSectionBreak()
    })
    expect(breaks.map((item) => item.kind)).toEqual(['page', 'section'])
  })
})

function recordBreaks(
  insert: (toolbar: ReturnType<typeof documentBreakToolbar>) => void,
) {
  let breaks: BreakDraft[] = []
  const toolbar = documentBreakToolbar({
    paragraphId: 'p1',
    model: singleParagraphModel(),
    offset: 2,
    selectionActive: false,
    trackChanges: false,
    setBreaks: (update) => {
      breaks = update(breaks)
    },
  })
  insert(toolbar)
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
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function paragraph(id: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}
