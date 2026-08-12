import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  applyDocumentEdits,
  createBlankDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  collectEditOperations,
  insertPlainText,
  isDraftDirty,
  removeInsert,
} from './document-edits'
import { documentStory } from './document-model-text'
import {
  applyReplaceRange,
  applySplitParagraph,
  emptyEditorState,
} from './document-word-edits'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
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
}

function blankParagraphModel(styleId?: string): DocumentModelWire {
  return {
    ...model,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            ...(styleId ? { styleId } : {}),
            runs: [],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
    ],
  }
}

describe('collectEditOperations', () => {
  it('emits replace then insert, and skips run edits on deleted paragraphs', () => {
    expect(
      collectEditOperations(
        model,
        { r1: 'Hello world' },
        [{ clientId: 'local_1', afterParagraphId: 'p1', text: 'Next' }],
        [],
      ),
    ).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'Hello world' },
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Next',
      },
    ])
    expect(
      collectEditOperations(model, { r1: 'Hello world' }, [], ['p1']),
    ).toEqual([{ type: 'delete_paragraph', paragraphId: 'p1' }])
  })

  it('skips unchanged run text and does not treat identical drafts as dirty', () => {
    expect(collectEditOperations(model, { r1: 'Hello' }, [], [])).toEqual([])
    expect(isDraftDirty(model, { r1: 'Hello' }, [], [])).toBe(false)
    expect(isDraftDirty(model, { r1: 'Hello world' }, [], [])).toBe(true)
  })

  it('flattens joined extra runs onto the last original run for save', () => {
    expect(
      collectEditOperations(model, {}, [], [], {
        p1: [{ id: 'r2', text: 'World', preservedXmlFragments: [] }],
      }),
    ).toEqual([{ type: 'replace_run_text', runId: 'r1', text: 'HelloWorld' }])
  })

  it('emits insert then delete for text typed into a zero-run paragraph', () => {
    const blank = blankParagraphModel()
    const typed = applyReplaceRange(
      blank,
      emptyEditorState(),
      'p1',
      0,
      0,
      'Typed line',
    )
    if (!typed) throw new Error('expected replace')
    expect(
      isDraftDirty(
        blank,
        typed.state.drafts,
        typed.state.inserts,
        typed.state.deletedParagraphIds,
        typed.state.extraRuns,
      ),
    ).toBe(true)
    expect(
      collectEditOperations(
        blank,
        typed.state.drafts,
        typed.state.inserts,
        typed.state.deletedParagraphIds,
        typed.state.extraRuns,
      ),
    ).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Typed line',
      },
      { type: 'delete_paragraph', paragraphId: 'p1' },
    ])
  })

  it('carries the blank paragraph style onto the replacement insert', () => {
    const blank = blankParagraphModel('Heading1')
    expect(
      collectEditOperations(blank, {}, [], [], {
        p1: [{ id: 'p1-r0', text: 'Typed', preservedXmlFragments: [] }],
      }),
    ).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Typed',
        styleId: 'Heading1',
      },
      { type: 'delete_paragraph', paragraphId: 'p1' },
    ])
  })

  it('re-anchors a chain of inserts onto the nearest model paragraph', () => {
    expect(
      collectEditOperations(
        model,
        {},
        [
          { clientId: 'I1', afterParagraphId: 'p1', text: 'First' },
          { clientId: 'I2', afterParagraphId: 'I1', text: 'Second' },
        ],
        [],
      ),
    ).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'First',
      },
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Second',
      },
    ])
  })

  it('saves a double-split through applyDocumentEdits in visual order', async () => {
    const document = await parseDocx(await createBlankDocx())
    const paragraph = documentStory(document.model)?.paragraphs[0]
    if (!paragraph) throw new Error('expected a body paragraph')
    const typed = applyReplaceRange(
      document.model,
      emptyEditorState(),
      paragraph.id,
      0,
      0,
      'Hello',
    )
    if (!typed) throw new Error('expected type')
    const firstSplit = applySplitParagraph(
      document.model,
      typed.state,
      { paragraphId: paragraph.id, offset: 5 },
      'I1',
    )
    if (!firstSplit) throw new Error('expected first split')
    const firstLine = applyReplaceRange(
      document.model,
      firstSplit.state,
      'I1',
      0,
      0,
      'First',
    )
    if (!firstLine) throw new Error('expected first insert text')
    const secondSplit = applySplitParagraph(
      document.model,
      firstLine.state,
      { paragraphId: 'I1', offset: 5 },
      'I2',
    )
    if (!secondSplit) throw new Error('expected second split')
    const secondLine = applyReplaceRange(
      document.model,
      secondSplit.state,
      'I2',
      0,
      0,
      'Second',
    )
    if (!secondLine) throw new Error('expected second insert text')
    const operations = collectEditOperations(
      document.model,
      secondLine.state.drafts,
      secondLine.state.inserts,
      secondLine.state.deletedParagraphIds,
      secondLine.state.extraRuns,
    )
    expect(operations).toEqual([
      { type: 'replace_run_text', runId: paragraph.runs[0]?.id, text: 'Hello' },
      {
        type: 'insert_paragraph_after',
        paragraphId: paragraph.id,
        text: 'First',
      },
      {
        type: 'insert_paragraph_after',
        paragraphId: paragraph.id,
        text: 'Second',
      },
    ])
    applyDocumentEdits(document, operations)
    const saved = await parseDocx(await serialiseDocx(document))
    expect(
      documentStory(saved.model)?.paragraphs.map((item) =>
        item.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['Hello', 'First', 'Second'])
  })

  it('keeps later inserts after a zero-run replacement, then deletes the blank', () => {
    const blank = blankParagraphModel()
    expect(
      collectEditOperations(
        blank,
        {},
        [{ clientId: 'local_1', afterParagraphId: 'p1', text: 'Next' }],
        [],
        {
          p1: [{ id: 'p1-r0', text: 'Typed', preservedXmlFragments: [] }],
        },
      ),
    ).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Typed',
      },
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Next',
      },
      { type: 'delete_paragraph', paragraphId: 'p1' },
    ])
  })
})

describe('insertPlainText', () => {
  it('uses the typed text when split runs are still empty', () => {
    expect(
      insertPlainText({
        clientId: 'ins1',
        afterParagraphId: 'p1',
        text: 'Signed',
        runs: [{ id: 'ins1-r0', text: '', preservedXmlFragments: [] }],
      }),
    ).toBe('Signed')
  })
})

describe('removeInsert', () => {
  it('reparents later inserts and selects the previous paragraph', () => {
    expect(
      removeInsert(
        [
          { clientId: 'a', afterParagraphId: 'p1', text: '' },
          { clientId: 'b', afterParagraphId: 'a', text: '' },
          { clientId: 'c', afterParagraphId: 'b', text: '' },
        ],
        'b',
      ),
    ).toEqual({
      inserts: [
        { clientId: 'a', afterParagraphId: 'p1', text: '' },
        { clientId: 'c', afterParagraphId: 'a', text: '' },
      ],
      selectId: 'a',
    })
  })
})
