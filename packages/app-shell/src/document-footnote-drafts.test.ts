import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useWorkspaceDraftHistory } from './document-editor-history'
import { createWorkspaceDraftEdits } from './components/document-workspace/workspace-draft-edits'
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
import { emptyFormatDrafts } from './document-format-types'
import { documentNotes, runNoteRefs } from './document-page-notes'
import { partitionDraftState } from './document-save-partition'
import {
  emptyDraftState,
  planDocumentSave,
  type DraftState,
} from './document-save-plan'
import {
  footnoteNoteParagraphId,
  structuralDraftSchema,
  structuralEditOperations,
  type StructuralDraft,
  type StructuralFootnoteDraft,
} from './document-structural-drafts'
import { withStructuralDrafts } from './document-structure-fold'
import { followFootnoteEdits } from './document-footnote-fold'
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
import { bodyStory } from './document-wire-test-support'

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
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

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
    fields: [],
    unanchoredFieldParagraphIds: [],
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
    const noteRef = runNoteRefs(
      ref?.preservedXmlFragments.join('') ?? '',
      ref?.id ?? '',
    )[0]
    expect(noteRef?.kind).toBe('footnote')

    const story = folded.stories.find((item) => item.kind === 'footnotes')
    expect(story).toBeDefined()
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

  it('renders a pending note with the Word footnote styles the document lacks', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const folded = withStructuralDrafts(base, [footnoteDraft('s1', 'p1', 6)])
    expect(folded.styles.map((style) => style.styleId)).toEqual([
      'FootnoteText',
      'FootnoteReference',
    ])
    const own = { styleId: 'FootnoteText', sourceFragment: '<w:style/>' }
    const kept = withStructuralDrafts({ ...base, styles: [own] }, [
      footnoteDraft('s1', 'p1', 6),
    ])
    expect(kept.styles[0]).toBe(own)
    expect(kept.styles.map((style) => style.styleId)).toEqual([
      'FootnoteText',
      'FootnoteReference',
    ])
  })

  it('numbers pending notes by where they sit, not the order they were inserted', () => {
    const base = model([
      bodyStory([paragraph('p1', 'Alpha'), paragraph('p2', 'Beta')]),
    ])
    const folded = withStructuralDrafts(base, [
      footnoteDraft('late', 'p2', 4),
      footnoteDraft('early', 'p1', 2),
      footnoteDraft('middle', 'p1', 5),
    ])
    const notes = documentNotes(folded)
    expect(notes.map((note) => [note.paragraphs[0]?.id, note.mark])).toEqual([
      [footnoteNoteParagraphId({ id: 'early' }), '1'],
      [footnoteNoteParagraphId({ id: 'middle' }), '2'],
      [footnoteNoteParagraphId({ id: 'late' }), '3'],
    ])
  })

  it('appends the pending entry to a footnotes story the model carries', () => {
    const existing = footnotesStory()
    const base = model([bodyStory([paragraph('p1', 'text')]), existing])
    const folded = withStructuralDrafts(base, [footnoteDraft('s1', 'p1', 2)])
    const story = folded.stories.find((item) => item.kind === 'footnotes')
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
      fields: [],
      unanchoredFieldParagraphIds: [],
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
    expect(plan.operations).toEqual([])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
      'extra-runs',
    ])
    expect(plan.blocked[0]?.reason).toBe(
      'A footnote can only be placed in the body.',
    )
    expect(plan.blocked[1]?.reason).toBe(plan.blocked[0]?.reason)
  })

  it('carries the reason onto the deferred note text when the anchor is deleted', () => {
    const draft = footnoteDraft('s1', 'p1', 0)
    const noteId = footnoteNoteParagraphId(draft)
    const state = {
      ...emptyDraftState(),
      structures: [draft as StructuralDraft],
      deletedParagraphIds: ['p1'],
      extraRuns: {
        [noteId]: [
          { id: `${noteId}-e`, text: 'A note', preservedXmlFragments: [] },
        ],
      },
    }
    const plan = planDocumentSave(
      model([bodyStory([paragraph('p1', 'text'), paragraph('p2')])]),
      state,
    )
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
      'extra-runs',
    ])
    expect(plan.blocked[0]?.reason).toBe(
      'The paragraph this was placed after is marked for deletion.',
    )
    expect(plan.blocked[1]?.reason).toBe(plan.blocked[0]?.reason)
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
    expect(paragraphDeletionRefusal(noted(), [], [], 'n2a')).toBeNull()
    expect(paragraphDeletionRefusal(noted(), [], ['n2b'], 'n2a')).toBe(
      'last-note-paragraph',
    )
  })

  it('maps the deletes that empty an entry to the note reason', () => {
    const emptied = emptiedParagraphDeletes(noted(), [], ['sep', 'n2a', 'n2b'])
    expect(emptied.get('sep')).toBe(LAST_NOTE_PARAGRAPH_MESSAGE)
    expect(emptied.get('n2a')).toBe(LAST_NOTE_PARAGRAPH_MESSAGE)
    expect(emptiedParagraphDeletes(noted(), [], ['n2a']).has('n2a')).toBe(false)
  })

  it('refuses a join that crosses a note entry boundary', () => {
    const state = emptyEditorState()
    expect(
      wordEditJoinRefusal(noted(), state, {
        type: 'deleteBackward',
        paragraphId: 'n2a',
        offset: 0,
      }),
    ).toBe('structure')
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
      format: emptyFormatDrafts,
      breaks: [],
      inserts: [],
      setStructures: (update) => {
        structures.push(...update([]))
      },
      toaFacts: {
        occurrences: [],
        entries: [],
        citingWires: [],
        fields: new Map(),
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
        fields: [],
        unanchoredFieldParagraphIds: [],
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

describe('footnotes following text edits', () => {
  const stored = (): DocumentModelWire =>
    model([
      bodyStory([
        {
          id: 'p1',
          runs: [
            { id: 'a', text: 'agreed terms', preservedXmlFragments: [] },
            {
              id: 'ref',
              text: '',
              preservedXmlFragments: [
                '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>',
                '<w:footnoteReference w:id="1"/>',
              ],
            },
            { id: 'b', text: ' on the date', preservedXmlFragments: [] },
          ],
          preservedXmlFragments: [],
        },
      ]),
    ])
  const edit = (
    base: DocumentModelWire,
    state: EditorState,
    from: number,
    to: number,
    insert = '',
  ) => {
    const result = applyWordEdit(
      base,
      state,
      { type: 'replace', paragraphId: 'p1', offset: from, from, to, insert },
      'new',
    )
    if (!result) throw new Error('edit refused')
    return result
  }
  const ids = () => {
    let next = 0
    return () => `removal-${String((next += 1))}`
  }

  it('moves a pending footnote with text typed before it', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const pending = [footnoteDraft('s1', 'p1', 5)]
    const before = emptyEditorState()
    const after = edit(base, before, 0, 0, 'Oh, ')
    const next = followFootnoteEdits(base, before, after, pending, ids())
    expect(next.structures).toEqual([footnoteDraft('s1', 'p1', 9)])
  })

  it('keeps a pending footnote in place when text is typed right after it', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const pending = [footnoteDraft('s1', 'p1', 5)]
    const before = emptyEditorState()
    const after = edit(base, before, 5, 5, '!')
    expect(
      followFootnoteEdits(base, before, after, pending, ids()).structures,
    ).toEqual(pending)
  })

  it('follows the caret, not the first repeated letter, when a letter goes', () => {
    const base = model([bodyStory([paragraph('p1', 'aaa')])])
    const pending = [footnoteDraft('s1', 'p1', 2)]
    const before = emptyEditorState()
    const after = edit(base, before, 0, 1)
    expect(
      followFootnoteEdits(base, before, after, pending, ids()).structures,
    ).toEqual([footnoteDraft('s1', 'p1', 1)])
  })

  it('drops a pending footnote and its note text when a deletion spans it', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const pending = [
      footnoteDraft('s1', 'p1', 5),
      footnoteDraft('s2', 'p1', 11),
    ]
    const before: EditorState = {
      ...emptyEditorState(),
      extraRuns: {
        [footnoteNoteParagraphId({ id: 's1' })]: [
          { id: 'n1', text: 'Gone', preservedXmlFragments: [] },
        ],
      },
    }
    const after = edit(base, before, 3, 8)
    const next = followFootnoteEdits(base, before, after, pending, ids())
    expect(next.structures).toEqual([footnoteDraft('s2', 'p1', 6)])
    expect(next.extraRuns).toEqual({})
  })

  it('marks a stored footnote for deletion when the deleted range spans its reference', () => {
    const base = stored()
    const before = emptyEditorState()
    const after = edit(base, before, 7, 15)
    const next = followFootnoteEdits(base, before, after, [], ids())
    expect(next.structures).toEqual([
      {
        id: 'removal-1',
        kind: 'footnote-removal',
        paragraphId: 'p1',
        runId: 'ref',
      },
    ])
    expect(documentNotes(withStructuralDrafts(base, next.structures))).toEqual(
      [],
    )
  })

  it('keeps a stored footnote when only the word before its reference is deleted', () => {
    const base = stored()
    const before = emptyEditorState()
    const after = edit(base, before, 7, 12)
    expect(
      followFootnoteEdits(base, before, after, [], ids()).structures,
    ).toEqual([])
  })

  it('removes a footnote ending its paragraph when a selected range through the end is deleted', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const pending = [footnoteDraft('s1', 'p1', 11)]
    const before = emptyEditorState()
    const after = edit(base, before, 6, 11)
    expect(
      followFootnoteEdits(base, before, after, pending, ids(), {
        anchor: { paragraphId: 'p1', offset: 6 },
        focus: { paragraphId: 'p1', offset: 11 },
      }).structures,
    ).toEqual([])
  })

  for (const [action, label] of [
    ['type', 'typing'],
    ['paste', 'pasting'],
    ['paste-lines', 'pasting multiple lines'],
    ['same-text', 'typing identical text'],
    ['range', 'replacing a document range'],
  ] as const) {
    for (const position of ['paragraph-final', 'mid-paragraph'] as const) {
      it(`${label} over a selection covering a ${position} reference removes its note and one Undo restores text and note`, () => {
        const base = stored()
        if (position === 'paragraph-final') {
          const runs = base.stories[0]?.paragraphs[0]?.runs
          runs?.pop()
        }
        base.stories.push({
          partName: 'word/footnotes.xml',
          kind: 'footnotes',
          paragraphs: [
            paragraph('n1', 'Selected note'),
            paragraph('n2', 'Kept note'),
          ],
          preservedXmlFragments: [
            '<w:footnote w:id="1"><w:p/></w:footnote>',
            '<w:footnote w:id="2"><w:p/></w:footnote>',
          ],
          fields: [],
          unanchoredFieldParagraphIds: [],
        })
        base.stories[0]?.paragraphs.push({
          id: 'p2',
          runs: [
            { id: 'c', text: 'Later', preservedXmlFragments: [] },
            {
              id: 'ref2',
              text: '',
              preservedXmlFragments: ['<w:footnoteReference w:id="2"/>'],
            },
          ],
          preservedXmlFragments: [],
        })
        let state = emptyDraftState()
        const before = structuredClone(state)
        const originalText = blockText(base, state, 'p1')
        const { result } = renderHook(() => useWorkspaceDraftHistory())
        const edits = createWorkspaceDraftEdits({
          getModel: () => base,
          getState: () => state,
          setState: (update) => {
            state = update(state)
          },
          checkpoint: (edit) => result.current.record(state, edit),
        })
        const to = position === 'paragraph-final' ? 12 : 15
        const replacement =
          action === 'same-text'
            ? originalText.slice(7, to)
            : action === 'paste-lines'
              ? 'pasted\ntext'
              : 'new'
        act(() => {
          if (action === 'type' || action === 'same-text') {
            expect(
              edits.handleWordEdit(base, {
                type: 'replace',
                paragraphId: 'p1',
                offset: 7,
                from: 7,
                to,
                insert: replacement,
              })?.status,
            ).toBe('applied')
          } else if (action === 'range') {
            expect(
              edits.replaceDocumentRange(
                base,
                { paragraphId: 'p1', offset: 7 },
                { paragraphId: 'p1', offset: to },
                replacement,
              ),
            ).not.toBeNull()
          } else {
            expect(
              edits.paste(
                base,
                {
                  kind: 'range',
                  from: { paragraphId: 'p1', offset: 7 },
                  to: { paragraphId: 'p1', offset: to },
                },
                replacement,
              )?.status,
            ).toBe('applied')
          }
        })
        expect(
          Object.values(state.extraRuns)
            .flat()
            .some((run) => run.id === 'ref'),
        ).toBe(false)
        expect(
          state.inserts
            .flatMap((insert) => insert.runs ?? [])
            .some((run) => run.id === 'ref'),
        ).toBe(false)
        expect(state.structures).toEqual([
          {
            id: expect.any(String),
            kind: 'footnote-removal',
            paragraphId: 'p1',
            runId: 'ref',
          },
        ])
        expect(blockText(base, state, 'p1')).toBe(
          originalText.slice(0, 7) +
            replacement.split('\n')[0] +
            (action === 'paste-lines' ? '' : originalText.slice(to)),
        )
        expect(
          documentNotes(withStructuralDrafts(base, state.structures)).map(
            (note) => [note.paragraphs[0]?.runs[0]?.text, note.mark],
          ),
        ).toEqual([['Kept note', '1']])
        act(() => {
          const restored = result.current.stepBack(state)
          if (!restored) throw new Error('Undo unavailable')
          state = restored
        })
        expect(state).toEqual(before)
        expect(blockText(base, state, 'p1')).toBe(originalText)
        expect(
          documentNotes(withStructuralDrafts(base, state.structures)).map(
            (note) => [note.paragraphs[0]?.runs[0]?.text, note.mark],
          ),
        ).toEqual([
          ['Selected note', '1'],
          ['Kept note', '2'],
        ])
        expect(result.current.canUndo).toBe(false)
      })
    }
  }

  for (const action of ['type', 'paste'] as const) {
    it(`${action} over a pending paragraph-final note drops its draft and text until one Undo restores them`, () => {
      const base = model([bodyStory([paragraph('p1', 'Hello world')])])
      const noteId = footnoteNoteParagraphId({ id: 's1' })
      let state: DraftState = {
        ...emptyDraftState(),
        structures: [footnoteDraft('s1', 'p1', 11)],
        extraRuns: { [noteId]: paragraph('note', 'Pending note').runs },
      }
      const before = structuredClone(state)
      const { result } = renderHook(() => useWorkspaceDraftHistory())
      const edits = createWorkspaceDraftEdits({
        getModel: () => base,
        getState: () => state,
        setState: (update) => {
          state = update(state)
        },
        checkpoint: (edit) => result.current.record(state, edit),
      })
      act(() => {
        if (action === 'type') {
          edits.handleWordEdit(base, {
            type: 'replace',
            paragraphId: 'p1',
            offset: 6,
            from: 6,
            to: 11,
            insert: 'new',
          })
        } else {
          edits.paste(
            base,
            {
              kind: 'range',
              from: { paragraphId: 'p1', offset: 6 },
              to: { paragraphId: 'p1', offset: 11 },
            },
            'new',
          )
        }
      })
      expect(state.structures).toEqual([])
      expect(state.extraRuns[noteId]).toBeUndefined()
      expect(blockText(base, state, 'p1')).toBe('Hello new')
      act(() => {
        const restored = result.current.stepBack(state)
        if (!restored) throw new Error('Undo unavailable')
        state = restored
      })
      expect(state).toEqual(before)
      expect(blockText(base, state, 'p1')).toBe('Hello world')
      expect(result.current.canUndo).toBe(false)
    })
  }

  for (const type of ['deleteBackward', 'deleteForward'] as const) {
    for (const join of [false, true]) {
      it(`collapsed ${type} ${join ? 'joining paragraphs' : 'beside a reference'} keeps the footnote`, () => {
        const base = stored()
        if (join) {
          base.stories[0]?.paragraphs[0]?.runs.pop()
          base.stories[0]?.paragraphs.push(paragraph('p2', 'Next'))
        }
        let state = emptyDraftState()
        const edits = createWorkspaceDraftEdits({
          getModel: () => base,
          getState: () => state,
          setState: (update) => {
            state = update(state)
          },
          checkpoint: () => {},
        })
        expect(
          edits.handleWordEdit(base, {
            type,
            paragraphId: join && type === 'deleteBackward' ? 'p2' : 'p1',
            offset: join && type === 'deleteBackward' ? 0 : 12,
          })?.status,
        ).toBe('applied')
        expect(state.structures).toEqual([])
        expect(state.deletedParagraphIds).toEqual(join ? ['p2'] : [])
      })
    }
  }

  it('keeps a footnote ending its paragraph when the last character is backspaced', () => {
    const base = model([bodyStory([paragraph('p1', 'Hello world')])])
    const pending = [footnoteDraft('s1', 'p1', 11)]
    const before = emptyEditorState()
    const backspaced = edit(base, before, 10, 11)
    expect(
      followFootnoteEdits(base, before, backspaced, pending, ids()).structures,
    ).toEqual([footnoteDraft('s1', 'p1', 10)])
  })

  it('numbers the remaining notes from one after a middle note goes', () => {
    const base = model([
      bodyStory([
        {
          id: 'p1',
          runs: ['1', '2', '3'].flatMap((n) => [
            { id: `t${n}`, text: `Cite ${n}.`, preservedXmlFragments: [] },
            {
              id: `r${n}`,
              text: '',
              preservedXmlFragments: [`<w:footnoteReference w:id="${n}"/>`],
            },
          ]),
          preservedXmlFragments: [],
        },
      ]),
      {
        partName: 'word/footnotes.xml',
        kind: 'footnotes',
        paragraphs: ['1', '2', '3'].map((n) => paragraph(`n${n}`, `Note ${n}`)),
        preservedXmlFragments: ['1', '2', '3'].map(
          (n) => `<w:footnote w:id="${n}"><w:p/></w:footnote>`,
        ),
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ])
    const before = emptyEditorState()
    const after = edit(base, before, 8, 15)
    const next = followFootnoteEdits(base, before, after, [], ids())
    const painted = withStructuralDrafts(
      base,
      next.structures,
      after.state.drafts,
    )
    expect(
      documentNotes(painted).map((note) => [note.paragraphs[0]?.id, note.mark]),
    ).toEqual([
      ['n1', '1'],
      ['n3', '2'],
    ])
  })
})
