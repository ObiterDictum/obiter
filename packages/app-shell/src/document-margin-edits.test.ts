import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectEditOperations,
  paragraphDeletionRefusal,
  storyFlowParagraphIds,
} from './document-edits'
import { findInDocument } from './document-find'
import {
  editableParagraph,
  editableStories,
  editableStoryOf,
} from './document-model-text'
import { documentListMarkers } from './document-page-lists'
import { editingStoryFor } from './document-page-layout'
import { editingStoryOfFlowId } from './document-story-flow'
import type { EditorState } from './document-word-edits'

const emptyState: EditorState = {
  drafts: {},
  inserts: [],
  deletedParagraphIds: [],
  extraRuns: {},
}

function paragraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] as string[] }],
    preservedXmlFragments: [] as string[],
  }
}

/** A body with a header and a footer story, as the parser emits them. */
const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [paragraph('p1', 'Body text'), paragraph('p2', 'Second')],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
    {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [paragraph('h1', 'Running head')],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
    {
      partName: 'word/footer1.xml',
      kind: 'footer',
      paragraphs: [paragraph('f1', 'Page footer'), paragraph('f2', 'More')],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
    {
      partName: 'word/footnotes.xml',
      kind: 'footnotes',
      paragraphs: [paragraph('n1', 'A note')],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
    {
      partName: 'word/endnotes.xml',
      kind: 'endnotes',
      paragraphs: [paragraph('e1', 'An endnote')],
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
  markings: {
    documentKind: null,
    draft: false,
    privileged: false,
    withoutPrejudice: false,
  },
}

describe('editable stories', () => {
  it('covers the body, the margins and footnotes but not endnotes', () => {
    expect(editableStories(model).map((story) => story.kind)).toEqual([
      'document',
      'header',
      'footer',
      'footnotes',
    ])
    expect(editableParagraph(model, 'h1')?.runs[0]?.text).toBe('Running head')
    expect(editableParagraph(model, 'n1')?.runs[0]?.text).toBe('A note')
    expect(editableParagraph(model, 'e1')).toBeUndefined()
    expect(editableStoryOf(model, 'f2')?.partName).toBe('word/footer1.xml')
  })

  it('resolves the final section header and footer for editing', () => {
    expect(editingStoryFor(model, 'document')?.partName).toBe(
      'word/document.xml',
    )
    expect(editingStoryFor(model, 'header')?.partName).toBe('word/header1.xml')
    expect(editingStoryFor(model, 'footer')?.partName).toBe('word/footer1.xml')
  })
})

describe('margin story flow', () => {
  it('orders a margin story on its own paragraphs', () => {
    const footer = editingStoryFor(model, 'footer')
    expect(storyFlowParagraphIds(footer, [], [])).toEqual(['f1', 'f2'])
    expect(storyFlowParagraphIds(footer, [], ['f2'])).toEqual(['f1'])
  })

  it('places a pending insert in the story its anchor belongs to', () => {
    const inserts = [
      { clientId: 'insert-1', afterParagraphId: 'h1', text: 'Typed' },
    ]
    expect(editingStoryOfFlowId(model, inserts, 'insert-1')?.partName).toBe(
      'word/header1.xml',
    )
    expect(
      storyFlowParagraphIds(editingStoryFor(model, 'header'), inserts, []),
    ).toEqual(['h1', 'insert-1'])
    // The body's flow does not claim the margin-anchored insert.
    expect(
      storyFlowParagraphIds(editingStoryFor(model, 'document'), inserts, []),
    ).toEqual(['p1', 'p2'])
  })
})

describe('the last-paragraph invariant per story', () => {
  it('refuses to empty the header while the body still has paragraphs', () => {
    expect(paragraphDeletionRefusal(model, [], [], 'h1')).toBe('last-paragraph')
    expect(paragraphDeletionRefusal(model, [], [], 'f1')).toBeNull()
    expect(paragraphDeletionRefusal(model, [], ['f1'], 'f2')).toBe(
      'last-paragraph',
    )
  })

  it('refuses to delete the last effective header insert', () => {
    const inserts = [
      { clientId: 'insert-1', afterParagraphId: 'h1', text: 'Typed' },
    ]
    // Deleting the stored header paragraph first leaves the insert holding
    // the story; the insert's own deletion is then refused.
    expect(paragraphDeletionRefusal(model, inserts, ['h1'], 'insert-1')).toBe(
      'last-paragraph',
    )
  })
})

describe('margin text edits in the save plan', () => {
  it('collects run edits from header and footer stories', () => {
    expect(
      collectEditOperations(
        model,
        { 'h1-r': 'New head', 'f1-r': 'New foot' },
        [],
        [],
      ),
    ).toEqual([
      { type: 'replace_run_text', runId: 'h1-r', text: 'New head' },
      { type: 'replace_run_text', runId: 'f1-r', text: 'New foot' },
    ])
  })

  it('anchors a pending insert in its own story', () => {
    expect(
      collectEditOperations(
        model,
        {},
        [{ clientId: 'insert-1', afterParagraphId: 'h1', text: 'Added' }],
        [],
      ),
    ).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'h1',
        intentId: 'insert-1',
        text: 'Added',
      },
    ])
  })

  it('does not collect edits against endnotes or other read-only stories', () => {
    expect(collectEditOperations(model, { 'e1-r': 'Changed' }, [], [])).toEqual(
      [],
    )
  })
})

describe('find inside the open story', () => {
  it('scopes hits to the given story', () => {
    const hits = findInDocument(
      model,
      emptyState,
      'text',
      editingStoryFor(model, 'document'),
    )
    expect(hits.map((hit) => hit.from.paragraphId)).toEqual(['p1'])
    const margin = findInDocument(
      model,
      emptyState,
      'Page',
      editingStoryFor(model, 'footer'),
    )
    expect(margin.map((hit) => hit.from.paragraphId)).toEqual(['f1'])
  })
})

describe('list markers in margin stories', () => {
  it('numbers a margin paragraph through the same numbering table', () => {
    const numbered: DocumentModelWire = {
      ...model,
      numbering: [
        {
          numberingId: 'num1',
          sourceFragment: '<w:num w:numId="num1"/>',
          abstractNumberingId: 'abs1',
          levels: [
            {
              ilvl: 0,
              numFmt: 'decimal',
              lvlText: '%1.',
              indentLeftTwips: 720,
              hangingTwips: 360,
            },
          ],
        },
      ],
      stories: [
        model.stories[0]!,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'h1-r', text: 'Listed', preservedXmlFragments: [] }],
              preservedXmlFragments: [
                '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="num1"/></w:numPr></w:pPr>',
              ],
            },
          ],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
    }
    expect(documentListMarkers(numbered).get('h1')?.text).toBe('1.')
  })
})
