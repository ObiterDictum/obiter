import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import {
  emptiedParagraphDeletes,
  LAST_NOTE_PARAGRAPH_MESSAGE,
  paragraphDeletionRefusal,
} from './document-edits'
import { documentStory, editableParagraph } from './document-model-text'
import { runNoteRefs } from './document-page-notes'
import { partitionDraftState } from './document-save-partition'
import { emptyDraftState, planDocumentSave } from './document-save-plan'
import {
  footnoteNoteParagraphId,
  structuralDraftSchema,
  structuralEditOperations,
  type StructuralDraft,
  type StructuralFootnoteDraft,
} from './document-structural-drafts'
import { withStructuralDrafts } from './document-structure-fold'
import {
  documentStructureToolbar,
  storyTableCellIds,
} from './document-structure-toolbar'
import {
  applyWordEdit,
  blockText,
  emptyEditorState,
  wordEditJoinRefusal,
  type EditorState,
} from './document-word-edits'

const footnoteDraft = (
  id: string,
  paragraphId: string,
  offset: number,
): StructuralFootnoteDraft => ({
  id,
  kind: 'footnote',
  paragraphId,
  offset,
})

function paragraph(
  id: string,
  text = 'text',
  fragments: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [
      {
        id: `${id}-r`,
        text,
        preservedXmlFragments: [] as string[],
      },
    ],
    preservedXmlFragments: fragments,
  }
}

function model(stories: DocumentStoryWire[]): DocumentModelWire {
  return {
    version: 1,
    stories,
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function bodyStory(paragraphs: DocumentParagraphWire[]): DocumentStoryWire {
  return {
    partName: 'word/document.xml',
    kind: 'document',
    paragraphs,
    preservedXmlFragments: [],
  }
}

/** A notes story holding a separator and one two-paragraph entry, as the
 * parser emits them: one fragment per note element, the paragraphs sliced
 * in `w:p` order. */
function footnotesStory(): DocumentStoryWire {
  return {
    partName: 'word/footnotes.xml',
    kind: 'footnotes',
    paragraphs: [
      paragraph('sep', ''),
      paragraph('n2a', 'First half'),
      paragraph('n2b', 'Second half'),
    ],
    preservedXmlFragments: [
      '<w:footnote w:type="separator" w:id="-1"><w:p w14:paraId="S"/></w:footnote>',
      '<w:footnote w:id="2"><w:p w14:paraId="A"/><w:p w14:paraId="B"/></w:footnote>',
    ],
  }
}

describe('folded footnote drafts', () => {
  it('splices a zero-width reference run and folds the pending note body', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const folded = withStructuralDrafts(base, [footnoteDraft('s1', 'p1', 6)])

    const body = documentStory(folded)
    const runs = body?.paragraphs[0]?.runs ?? []
    expect(runs.map((run) => run.text)).toEqual(['Hello ', '', 'world'])
    const ref = runs[1]
    expect(ref?.preservedXmlFragments[0]).toContain('<w:footnoteReference')
    // The mark paints through the same stored-reference path a reparse reads.
    const noteRef = runNoteRefs(
      ref?.preservedXmlFragments.join('') ?? '',
      ref?.id ?? '',
    )[0]
    expect(noteRef?.kind).toBe('footnote')

    const story = folded.stories.find((item) => item.kind === 'footnotes')
    expect(story).toBeDefined()
    // A created part carries the separator entries the writer emits.
    expect(
      story?.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:type="separator"'),
      ),
    ).toBe(true)
    expect(
      story?.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:type="continuationSeparator"'),
      ),
    ).toBe(true)
    expect(
      story?.preservedXmlFragments.some(
        (fragment) =>
          fragment.includes(`w:id="${noteRef?.noteId ?? ''}"`) &&
          fragment.includes('<w:footnote '),
      ),
    ).toBe(true)

    const note = editableParagraph(
      folded,
      footnoteNoteParagraphId({ id: 's1' }),
    )
    expect(note).toBeDefined()
    expect(note?.preservedXmlFragments[0]).toContain('FootnoteText')
    expect(
      note?.runs[0]?.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:footnoteRef'),
      ),
    ).toBe(true)
  })

  it('appends the pending entry to a footnotes story the model carries', () => {
    const existing = footnotesStory()
    const base = model([bodyStory([paragraph('p1', 'text')]), existing])
    const folded = withStructuralDrafts(base, [footnoteDraft('s1', 'p1', 2)])
    const story = folded.stories.find((item) => item.kind === 'footnotes')
    // The stored entries keep their order; the pending entry lands last.
    expect(story?.paragraphs.map((item) => item.id)).toEqual([
      'sep',
      'n2a',
      'n2b',
      's1:note',
    ])
    expect(story?.preservedXmlFragments).toHaveLength(3)
  })

  it('allocates the pending note id above every stored id', () => {
    const base = model([bodyStory([paragraph('p1', 'text')]), footnotesStory()])
    const folded = withStructuralDrafts(base, [
      footnoteDraft('s1', 'p1', 0),
      footnoteDraft('s2', 'p1', 4),
    ])
    const body = documentStory(folded)
    const refs = body?.paragraphs[0]?.runs.flatMap((run) =>
      runNoteRefs(run.preservedXmlFragments.join(''), run.id),
    )
    // Stored ids run to 2, so the pending pair takes 3 and 4 in draft order.
    expect(refs?.map((ref) => ref.noteId)).toEqual(['3', '4'])
  })

  it('returns the model unchanged when the anchor is not in the body', () => {
    const base = model([bodyStory([paragraph('p1', 'text')])])
    expect(withStructuralDrafts(base, [footnoteDraft('s1', 'gone', 0)])).toBe(
      base,
    )
  })
})

describe('pending note text', () => {
  it('types into the folded note body through the stored model', () => {
    const base = model([bodyStory([paragraph('p1', 'text')])])
    const noteId = footnoteNoteParagraphId({ id: 's1' })
    const typed = applyWordEdit(
      base,
      emptyEditorState(),
      {
        type: 'replace',
        paragraphId: noteId,
        offset: 0,
        insert: 'See the lease',
      },
      'new-id',
    )
    expect(typed).toBeDefined()
    const noteRuns = typed?.state.extraRuns[noteId] ?? []
    expect(noteRuns.map((run) => run.text).join('')).toBe('See the lease')
    expect(blockText(base, typed?.state ?? emptyEditorState(), noteId)).toBe(
      'See the lease',
    )
  })

  it('carries a line break, not a paragraph split, inside the pending note', () => {
    const base = model([bodyStory([paragraph('p1', 'text')])])
    const noteId = footnoteNoteParagraphId({ id: 's1' })
    const state: EditorState = {
      ...emptyEditorState(),
      extraRuns: {
        [noteId]: [
          { id: `${noteId}-e`, text: 'half', preservedXmlFragments: [] },
        ],
      },
    }
    const split = applyWordEdit(
      base,
      state,
      {
        type: 'split',
        paragraphId: noteId,
        offset: 4,
      },
      'new-id',
    )
    // No insert is minted: the note paragraph has no stored anchor, so Enter
    // writes `\n` into the pending runs like Shift+Enter in a stored one.
    expect(split?.state.inserts).toEqual([])
    expect(
      (split?.state.extraRuns[noteId] ?? []).map((run) => run.text).join(''),
    ).toBe('half\n')
  })

  it('emits the typed note text as the insert_footnote payload', () => {
    const draft = footnoteDraft('s1', 'p1', 2)
    const noteId = footnoteNoteParagraphId(draft)
    const operations = structuralEditOperations(
      [draft],
      new Set(),
      {},
      {
        [noteId]: [
          { id: `${noteId}-e`, text: 'The note', preservedXmlFragments: [] },
        ],
      },
    )
    expect(operations).toEqual([
      {
        type: 'insert_footnote',
        paragraphId: 'p1',
        offset: 2,
        text: 'The note',
      },
    ])
  })
})

describe('footnote save partitioning', () => {
  it('covers the structure and its deferred note text together', () => {
    const draft = footnoteDraft('s1', 'p1', 2)
    const noteId = footnoteNoteParagraphId(draft)
    const state = {
      ...emptyDraftState(),
      structures: [draft as StructuralDraft],
      extraRuns: {
        [noteId]: [
          { id: `${noteId}-e`, text: 'A note', preservedXmlFragments: [] },
        ],
      },
    }
    const base = model([bodyStory([paragraph('p1', 'text')])])
    const plan = planDocumentSave(base, state)
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toEqual([
      {
        type: 'insert_footnote',
        paragraphId: 'p1',
        offset: 2,
        text: 'A note',
      },
    ])
    expect(plan.covered.map((slot) => slot.kind)).toEqual([
      'structure',
      'extra-runs',
    ])
  })

  it('blocks a footnote whose anchor is not a body paragraph', () => {
    const header: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [paragraph('h1', 'Running head')],
      preservedXmlFragments: [],
    }
    const draft = footnoteDraft('s1', 'h1', 0)
    const noteId = footnoteNoteParagraphId(draft)
    const state = {
      ...emptyDraftState(),
      structures: [draft as StructuralDraft],
      extraRuns: {
        [noteId]: [
          { id: `${noteId}-e`, text: 'A note', preservedXmlFragments: [] },
        ],
      },
    }
    const plan = planDocumentSave(
      model([bodyStory([paragraph('p1', 'text')]), header]),
      state,
    )
    // The note text lives and dies with its structure: both are held back
    // rather than one shipping and the other silently dropping.
    expect(plan.operations).toEqual([])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
      'extra-runs',
    ])
    expect(plan.blocked[0]?.reason).toBe(
      'A footnote can only be placed in the body.',
    )
  })

  it('blocks a page number anchored in a note paragraph', () => {
    const draft: StructuralDraft = {
      id: 's1',
      kind: 'page-number',
      paragraphId: 'n2a',
      offset: 0,
    }
    const plan = planDocumentSave(
      model([bodyStory([paragraph('p1', 'text')]), footnotesStory()]),
      { ...emptyDraftState(), structures: [draft] },
    )
    // A restored draft the ribbon never got to refuse is still held back
    // here rather than failing the whole save at the writer.
    expect(plan.operations).toEqual([])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toBe(
      'A page number needs a page of its own: the body, a header or a footer.',
    )
  })

  it('blocks pending note runs whose structure cannot save', () => {
    const noteId = footnoteNoteParagraphId({ id: 's1' })
    const state = {
      ...emptyDraftState(),
      extraRuns: {
        [noteId]: [
          { id: `${noteId}-e`, text: 'orphaned', preservedXmlFragments: [] },
        ],
      },
    }
    const partition = partitionDraftState(
      model([bodyStory([paragraph('p1', 'text')])]),
      state,
    )
    // No structure owns the id, so the runs partition like any other
    // unaddressable edit — disclosed, not sent.
    expect(partition.blocked.map((item) => item.slot.kind)).toEqual([
      'extra-runs',
    ])
  })
})

describe('note entry boundaries', () => {
  const noted = () =>
    model([bodyStory([paragraph('p1', 'text')]), footnotesStory()])

  it('refuses to empty a note entry while the story keeps others', () => {
    expect(paragraphDeletionRefusal(noted(), [], [], 'sep')).toBe(
      'last-note-paragraph',
    )
    // The entry with two paragraphs survives losing one.
    expect(paragraphDeletionRefusal(noted(), [], [], 'n2a')).toBeNull()
    // ...but not losing both.
    expect(paragraphDeletionRefusal(noted(), [], ['n2b'], 'n2a')).toBe(
      'last-note-paragraph',
    )
  })

  it('maps the deletes that empty an entry to the note reason', () => {
    const emptied = emptiedParagraphDeletes(noted(), [], ['sep', 'n2a', 'n2b'])
    expect(emptied.get('sep')).toBe(LAST_NOTE_PARAGRAPH_MESSAGE)
    expect(emptied.get('n2a')).toBe(LAST_NOTE_PARAGRAPH_MESSAGE)
    // Deleting only one of the entry's two leaves a survivor.
    expect(emptiedParagraphDeletes(noted(), [], ['n2a']).has('n2a')).toBe(false)
  })

  it('refuses a join that crosses a note entry boundary', () => {
    const state = emptyEditorState()
    // Backspace at the start of a note's first paragraph would merge the
    // separator entry's paragraph into it — a different `w:footnote`.
    expect(
      wordEditJoinRefusal(noted(), state, {
        type: 'deleteBackward',
        paragraphId: 'n2a',
        offset: 0,
      }),
    ).toBe('structure')
    // Inside the entry the join composes.
    expect(
      wordEditJoinRefusal(noted(), state, {
        type: 'deleteBackward',
        paragraphId: 'n2b',
        offset: 0,
      }),
    ).not.toBe('structure')
  })
})

describe('the footnote insert control', () => {
  const toolbar = (
    overrides: Partial<Parameters<typeof documentStructureToolbar>[0]> = {},
    baseModel = model([bodyStory([paragraph('p1', 'text')])]),
  ) => {
    const structures: StructuralDraft[] = []
    const api = documentStructureToolbar({
      paragraphId: 'p1',
      model: baseModel,
      cellParagraphIds: storyTableCellIds(documentStory(baseModel)),
      offset: 2,
      selectionActive: false,
      selectionRange: null,
      deletedParagraphIds: new Set<string>(),
      trackChanges: false,
      structures,
      drafts: {},
      extraRuns: {},
      setStructures: (update) => {
        structures.push(...update([]))
      },
      ...overrides,
    })
    return { api, structures }
  }

  it('inserts a draft and names the folded note paragraph', () => {
    const { api, structures } = toolbar()
    expect(api.footnoteUnavailable).toBeUndefined()
    const outcome = api.insertFootnote()
    expect(outcome.inserted).toBe(true)
    expect(structures).toHaveLength(1)
    expect(structures[0]).toMatchObject({ kind: 'footnote', offset: 2 })
    if (!outcome.inserted) throw new Error('expected an insertion')
    expect(outcome.noteParagraphId).toBe(
      footnoteNoteParagraphId({ id: structures[0]?.id ?? '' }),
    )
  })

  it('refuses honestly when tracking, selecting, or unanchored', () => {
    expect(toolbar({ trackChanges: true }).api.footnoteUnavailable).toContain(
      'tracked',
    )
    expect(
      toolbar({ selectionActive: true }).api.footnoteUnavailable,
    ).toBeTruthy()
    expect(toolbar({ paragraphId: null }).api.footnoteUnavailable).toBeTruthy()
    expect(toolbar({ offset: null }).api.footnoteUnavailable).toBeTruthy()
    expect(
      toolbar({ paragraphId: 'pending_1' }).api.footnoteUnavailable,
    ).toContain('Save the new paragraph')
  })

  it('refuses outside the body and inside a table cell', () => {
    const margin = model([
      bodyStory([paragraph('p1', 'text')]),
      {
        partName: 'word/header1.xml',
        kind: 'header',
        paragraphs: [paragraph('h1', 'Running head')],
        preservedXmlFragments: [],
      },
    ])
    expect(
      toolbar({ paragraphId: 'h1' }, margin).api.footnoteUnavailable,
    ).toContain('body')

    const cellStory = {
      ...bodyStory([paragraph('para-w14-AABB0001', '', [])]),
      paragraphs: [
        {
          id: 'para-w14-AABB0001',
          sourceParaId: 'AABB0001',
          runs: [],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [
        '<w:tbl><w:tr><w:tc><w:p w14:paraId="AABB0001"/></w:tc></w:tr></w:tbl>',
      ],
    }
    const cells = model([cellStory])
    expect(
      toolbar({ paragraphId: 'para-w14-AABB0001' }, cells).api
        .footnoteUnavailable,
    ).toContain('cell')
  })

  it('refuses a page number with the caret in a note paragraph', () => {
    const notes = model([
      bodyStory([paragraph('p1', 'text')]),
      footnotesStory(),
    ])
    // The ribbon applies the writer's story-kind rule: a note has no page
    // for the field to resolve, so the refusal names the real reason.
    const { api } = toolbar({ paragraphId: 'n2a' }, notes)
    expect(api.pageNumberUnavailable).toBe(
      'A page number needs a page of its own: the body, a header or a footer.',
    )
    expect(api.insertPageNumber()).toEqual({
      inserted: false,
      reason:
        'A page number needs a page of its own: the body, a header or a footer.',
    })
    expect(
      toolbar({ paragraphId: 'p1' }, notes).api.pageNumberUnavailable,
    ).toBeUndefined()
  })

  it('refuses a second splice inside the run an earlier footnote opened', () => {
    const { api, structures } = toolbar({ offset: 1 })
    expect(api.insertFootnote().inserted).toBe(true)
    // The first reference poisons the run it landed in; a splice at the same
    // paragraph but strictly inside that run cannot compose.
    const again = toolbar({ offset: 3, structures })
    expect(again.api.footnoteUnavailable).toContain('footnote')
  })

  it('round-trips the draft through the persisted schema', () => {
    expect(
      structuralDraftSchema.safeParse(footnoteDraft('s1', 'p1', 2)).success,
    ).toBe(true)
    expect(
      structuralDraftSchema.safeParse({
        ...footnoteDraft('s1', 'p1', 2),
        text: 'smuggled',
      }).success,
    ).toBe(false)
    expect(
      structuralDraftSchema.safeParse(footnoteDraft('s1', 'p1', -1)).success,
    ).toBe(false)
  })
})
