// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { collectEditOperations } from './document-edits'
import {
  applyReplaceDocumentRange,
  applySplitOverDocumentRange,
} from './document-range-edits'
import {
  blockText,
  emptyEditorState,
  type EditorState,
} from './document-word-edits'

function para(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function doc(...paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: 'word/document.xml',
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

function operations(model: DocumentModelWire, state: EditorState) {
  return collectEditOperations(
    model,
    state.drafts,
    state.inserts,
    state.deletedParagraphIds,
    state.extraRuns,
    undefined,
  )
}

describe('replacing a range inside one paragraph', () => {
  it('replaces the range and leaves the caret after the text', () => {
    const model = doc(para('p1', 'Hello world'))
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p1', offset: 11 },
      'there',
    )
    expect(result).toBeDefined()
    expect(blockText(model, result?.state ?? emptyEditorState(), 'p1')).toBe(
      'Hellothere',
    )
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 10 })
  })

  it('is a no-op for a collapsed range with nothing to insert', () => {
    const model = doc(para('p1', 'Hello'))
    const state = emptyEditorState()
    const result = applyReplaceDocumentRange(
      model,
      state,
      { paragraphId: 'p1', offset: 2 },
      { paragraphId: 'p1', offset: 2 },
      '',
    )
    expect(result?.state).toBe(state)
    expect(operations(model, result?.state ?? state)).toEqual([])
  })
})

describe('replacing a range across paragraphs', () => {
  it('keeps the head, the tail and the inserted text, and deletes the rest', () => {
    const model = doc(
      para('p1', 'alpha'),
      para('p2', 'bravo'),
      para('p3', 'charlie'),
    )
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 2 },
      { paragraphId: 'p3', offset: 4 },
      'X',
    )
    const state = result?.state ?? emptyEditorState()
    expect(blockText(model, state, 'p1')).toBe('alXlie')
    expect(state.deletedParagraphIds).toEqual(['p2', 'p3'])
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 3 })
    expect(operations(model, state)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'alXlie' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
      { type: 'delete_paragraph', paragraphId: 'p3' },
    ])
  })

  it('joins across an empty middle paragraph', () => {
    const model = doc(
      para('p1', 'alpha'),
      para('p2', ''),
      para('p3', 'charlie'),
    )
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p3', offset: 0 },
      '',
    )
    const state = result?.state ?? emptyEditorState()
    // The range covers the two paragraph breaks; the tail paragraph keeps its
    // text and joins onto the head, which is what deleting a break does.
    expect(blockText(model, state, 'p1')).toBe('alphacharlie')
    expect(state.deletedParagraphIds).toEqual(['p2', 'p3'])
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 5 })
  })

  it('deletes a fully selected hard-break paragraph between the endpoints', () => {
    const model = doc(
      para('p1', 'alpha'),
      para('p2', 'one\ntwo'),
      para('p3', 'zulu'),
    )
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p3', offset: 2 },
      '',
    )
    const state = result?.state ?? emptyEditorState()
    expect(blockText(model, state, 'p1')).toBe('alphalu')
    expect(state.deletedParagraphIds).toEqual(['p2', 'p3'])
  })

  it('moves the insert to the join point, keeping the tail after it', () => {
    const model = doc(para('p1', 'alpha'), para('p2', 'bravo'))
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p2', offset: 3 },
      '!',
    )
    const state = result?.state ?? emptyEditorState()
    expect(blockText(model, state, 'p1')).toBe('alpha!vo')
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 6 })
  })

  it('fails closed when an endpoint paragraph is not in the flow', () => {
    const model = doc(para('p1', 'alpha'))
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'gone', offset: 0 },
        { paragraphId: 'p1', offset: 2 },
        '',
      ),
    ).toBeUndefined()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p1', offset: 2 },
        { paragraphId: 'gone', offset: 0 },
        '',
      ),
    ).toBeUndefined()
    // Nothing was mutated by the refused call.
    expect(operations(model, state)).toEqual([])
  })

  it('refuses reversed endpoints rather than deleting the wrong range', () => {
    const model = doc(para('p1', 'alpha'), para('p2', 'bravo'))
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p2', offset: 2 },
        { paragraphId: 'p1', offset: 3 },
        '',
      ),
    ).toBeUndefined()
    expect(blockText(model, state, 'p1')).toBe('alpha')
  })

  it('removes a pending inserted paragraph in the range', () => {
    const model = doc(para('p1', 'alpha'), para('p2', 'bravo'))
    const state: EditorState = {
      ...emptyEditorState(),
      inserts: [
        { clientId: 'ins_1', afterParagraphId: 'p1', text: 'inserted' },
      ],
    }
    const result = applyReplaceDocumentRange(
      model,
      state,
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p2', offset: 0 },
      '',
    )
    const next = result?.state ?? state
    // The inserted paragraph's text is inside the range, so it is deleted;
    // the tail paragraph's text is after the range and joins onto the head.
    expect(next.inserts).toEqual([])
    expect(blockText(model, next, 'p1')).toBe('alphabravo')
  })
})

describe('splitting over a range', () => {
  it('collapses the range and splits at the join point', () => {
    const model = doc(para('p1', 'alpha'), para('p2', 'bravo'))
    const result = applySplitOverDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 2 },
      { paragraphId: 'p2', offset: 3 },
      'new_1',
    )
    const state = result?.state ?? emptyEditorState()
    expect(blockText(model, state, 'p1')).toBe('al')
    const inserted = state.inserts.find((item) => item.clientId === 'new_1')
    expect(inserted?.afterParagraphId).toBe('p1')
    expect((inserted?.runs ?? []).map((run) => run.text).join('')).toBe('vo')
    expect(state.deletedParagraphIds).toEqual(['p2'])
    expect(result?.caret).toEqual({ paragraphId: 'new_1', offset: 0 })
  })
})

function run(
  id: string,
  text: string,
  preservedXmlFragments: string[] = [],
  styleId?: string,
): DocumentParagraphWire['runs'][number] {
  return { id, text, preservedXmlFragments, ...(styleId ? { styleId } : {}) }
}

/** Body p1, a two-cell table, then body p4. Cell paragraphs are structural. */
function tabledDoc(): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: 'word/document.xml',
        paragraphs: [
          { id: 'p1', runs: [run('p1-r', 'Alpha')], preservedXmlFragments: [] },
          {
            id: 'para-w14-CELL0001',
            runs: [run('c1-r', 'Cell one')],
            preservedXmlFragments: [],
          },
          {
            id: 'para-w14-CELL0002',
            runs: [run('c2-r', 'Cell two')],
            preservedXmlFragments: [],
          },
          { id: 'p4', runs: [run('p4-r', 'Delta')], preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [
          '<w:tbl><w:tr><w:tc><w:p w14:paraId="CELL0001"><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="CELL0002"><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

describe('a range that would cross a table', () => {
  it('is refused rather than merging body paragraphs around the cells', () => {
    const model = tabledDoc()
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p1', offset: 2 },
        { paragraphId: 'p4', offset: 2 },
        '',
      ),
    ).toBeUndefined()
    // Nothing was mutated, and no operation targets a cell paragraph.
    const ops = operations(model, state)
    expect(ops).toEqual([])
    expect(
      ops.some(
        (op) =>
          op.type === 'delete_paragraph' &&
          op.paragraphId.startsWith('para-w14-'),
      ),
    ).toBe(false)
  })

  it('refuses a range that ends inside a cell', () => {
    const model = tabledDoc()
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p1', offset: 0 },
        { paragraphId: 'para-w14-CELL0002', offset: 4 },
        '',
      ),
    ).toBeUndefined()
    expect(blockText(model, state, 'p1')).toBe('Alpha')
    expect(blockText(model, state, 'para-w14-CELL0001')).toBe('Cell one')
  })

  it('still replaces a range that stays inside the body', () => {
    const model = tabledDoc()
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 0 },
      { paragraphId: 'p1', offset: 5 },
      'Omega',
    )
    expect(blockText(model, result?.state ?? emptyEditorState(), 'p1')).toBe(
      'Omega',
    )
  })
})

describe('a join preserves the surviving tail run formatting', () => {
  it('restates an italic tail run as a range emphasis on the merged paragraph', () => {
    const model = doc(para('p1', 'alpha'), {
      id: 'p2',
      runs: [run('p2-r', 'bravo', ['<w:rPr><w:i/></w:rPr>'])],
      preservedXmlFragments: [],
    })
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 2 },
      { paragraphId: 'p2', offset: 3 },
      '',
    )
    const state = result?.state ?? emptyEditorState()
    expect(blockText(model, state, 'p1')).toBe('alvo')
    const ops = operations(model, state)
    expect(ops).toContainEqual(
      expect.objectContaining({
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 4,
        italic: true,
      }),
    )
  })

  it('clears the head run formatting the tail run does not set', () => {
    const model = doc(
      {
        id: 'p1',
        runs: [run('p1-r', 'alpha', ['<w:rPr><w:b/></w:rPr>'])],
        preservedXmlFragments: [],
      },
      para('p2', 'bravo'),
    )
    const result = applyReplaceDocumentRange(
      model,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      { paragraphId: 'p2', offset: 2 },
      '',
    )
    const state = result?.state ?? emptyEditorState()
    const ops = operations(model, state)
    // The appended 'vo' is not bold even though the head run it folds into is,
    // so the emphasis strips the head run's direct bold rather than keeping it.
    expect(ops).toContainEqual(
      expect.objectContaining({
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 8,
        bold: null,
        italic: null,
      }),
    )
  })

  it('refuses a tail whose structural child the save cannot restate', () => {
    const model = doc(para('p1', 'alpha'), {
      id: 'p2',
      runs: [run('p2-r', 'bravo', ['<w:bookmarkStart w:id="1"/>'])],
      preservedXmlFragments: [],
    })
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p1', offset: 2 },
        { paragraphId: 'p2', offset: 3 },
        '',
      ),
    ).toBeUndefined()
    expect(operations(model, state)).toEqual([])
  })

  it('refuses a tail whose character style it cannot restate', () => {
    const model = doc(para('p1', 'alpha'), {
      id: 'p2',
      runs: [run('p2-r', 'bravo', [], 'Emphasis')],
      preservedXmlFragments: [],
    })
    const state = emptyEditorState()
    expect(
      applyReplaceDocumentRange(
        model,
        state,
        { paragraphId: 'p1', offset: 2 },
        { paragraphId: 'p2', offset: 3 },
        '',
      ),
    ).toBeUndefined()
  })
})
