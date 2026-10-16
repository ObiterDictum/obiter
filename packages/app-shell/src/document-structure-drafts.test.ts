import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { MapStorage, scope } from './document-draft-store-test-support'
import { emptyFormatDrafts } from './document-format-types'
import { readDocumentDraft, writeDocumentDraft } from './document-draft-store'
import {
  imagePartNameForDrawing,
  paragraphImageXml,
} from './document-page-media'
import { storyBlocks } from './document-page-tables'
import { documentStory } from './document-model-text'
import { withStructuralDrafts } from './document-structure-fold'
import {
  documentStructureToolbar,
  storyTableCellIds,
} from './document-structure-toolbar'
import { DOCUMENT_EDIT_IMAGE_DIMENSION_MAX } from '@obiter/contracts'
import {
  pendingImagePartName,
  scaleImageInsertSize,
} from './document-image-inserts'
import {
  structuralDraftSchema,
  type StructuralDraft,
  type StructuralImageDraft,
} from './document-structural-drafts'
import {
  clearableSlots,
  emptyDraftState,
  hasDraftState,
  planDocumentSave,
  removeDraftSlots,
  slotLabel,
  type DraftState,
  type DraftSlot,
} from './document-save-plan'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const tableDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'table',
  paragraphId,
  rows: 2,
  columns: 2,
})

const imageDraft = (
  id: string,
  paragraphId: string,
  offset: number,
): StructuralImageDraft => ({
  id,
  kind: 'image',
  paragraphId,
  offset,
  contentType: 'image/png',
  dataBase64: PNG_BASE64,
  widthPx: 48,
  heightPx: 32,
  name: 'Figure',
})

const definedTermDraft = (
  id: string,
  paragraphId: string,
  from = 0,
  to = 4,
  marked = 'text',
): StructuralDraft => ({
  id,
  kind: 'defined-term',
  paragraphId,
  from,
  to,
  marked,
})

function paragraph(
  id: string,
  text = 'text',
  sourceParaId?: string,
): DocumentParagraphWire {
  return {
    id,
    ...(sourceParaId ? { sourceParaId } : {}),
    runs: text ? [{ id: `${id}-r`, text, preservedXmlFragments: [] }] : [],
    preservedXmlFragments: [],
  }
}

function model(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
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
}

function requiredStory(document: DocumentModelWire, index = 0) {
  const story = document.stories[index]
  if (!story) throw new Error('Fixture story is missing.')
  return story
}

describe('withStructuralDrafts', () => {
  it('folds a table into cell wires and a fragment the table paint binds', () => {
    const base = model([paragraph('p1', 'First'), paragraph('p2', 'Second')])
    const folded = withStructuralDrafts(base, [tableDraft('s1', 'p1')])

    const story = folded.stories[0]
    expect(story?.preservedXmlFragments).toHaveLength(1)
    const fragment = story?.preservedXmlFragments[0] ?? ''
    expect(fragment).toContain('<w:tbl')

    // The writer's own fragment binds the folded cell wires through the same
    // `para-w14-` ids a reparse would allocate.
    const blocks = storyBlocks(story)
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'table',
      'paragraph',
    ])
    const table = blocks[1]
    if (table?.type !== 'table') throw new Error('expected a table block')
    expect(table.table.rows).toHaveLength(2)
    expect(table.table.rows[0]?.cells).toHaveLength(2)
    expect(blocks[2]?.type === 'paragraph' && blocks[2].paragraph.id).toBe('p2')
  })

  it('appends the boundary paragraph a body-final table needs', () => {
    const base = model([paragraph('p1', 'Only')])
    const folded = withStructuralDrafts(base, [tableDraft('s1', 'p1')])
    const blocks = storyBlocks(requiredStory(folded))
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'table',
      'paragraph',
    ])
  })

  it('separates two tables at one anchor, matching the save order', () => {
    const base = model([paragraph('p1', 'Anchor'), paragraph('p2', 'Next')])
    const folded = withStructuralDrafts(base, [
      tableDraft('s1', 'p1'),
      tableDraft('s2', 'p1'),
    ])
    const blocks = storyBlocks(requiredStory(folded))
    // The separator paragraph sits between the tables, as it serialises —
    // two adjacent `w:tbl` elements would merge on reload.
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'table',
      'paragraph',
      'table',
      'paragraph',
    ])
    expect(folded.stories[0]?.preservedXmlFragments).toHaveLength(2)
  })

  it('skips a structure whose anchor was deleted', () => {
    const base = model([paragraph('p1'), paragraph('p2')])
    const folded = withStructuralDrafts(
      base,
      [tableDraft('s1', 'p1')],
      {},
      new Set(['p1']),
    )
    expect(folded).toBe(base)
  })

  it('folds an image into a drawing run and a resolvable relationship', () => {
    const base = model([paragraph('p1', 'Hello world')])
    const draft = imageDraft('s1', 'p1', 6)
    const folded = withStructuralDrafts(base, [draft])

    const target = folded.stories[0]?.paragraphs[0]
    const fragments = target ? paragraphImageXml(target) : []
    expect(fragments).toHaveLength(1)
    expect(fragments[0]).toContain('<w:drawing')

    // The drawing run is zero-length between the head and the tail — the same
    // split the writer performs on save.
    const runs = target?.runs ?? []
    expect(runs.map((run) => run.text)).toEqual(['Hello ', '', 'world'])
    expect(runs[1]?.preservedXmlFragments[0]).toContain('r:embed=')

    // The pending relationship resolves through the same lookup a reloaded
    // image uses, to the part name `pendingImageUrls` keys its blob by.
    const partName = imagePartNameForDrawing(
      fragments[0] ?? '',
      'word/document.xml',
      folded.relationships,
    )
    expect(partName).toBe(pendingImagePartName(draft))
  })

  it('splices a picture inside a run whose text is being replaced', () => {
    const base = model([paragraph('p1', 'Hello world')])
    const drafts = { 'p1-r': 'Hello brave world' }
    const folded = withStructuralDrafts(
      base,
      [imageDraft('s1', 'p1', 6)],
      drafts,
    )
    const runs = requiredStory(folded).paragraphs[0]?.runs ?? []
    // The offset addresses effective text, so the drawing lands inside the
    // typed replacement — the same split the writer's pending overlay makes.
    expect(runs.map((run) => run.text)).toEqual(['Hello ', '', 'brave world'])
    // Neither half keeps `p1-r`: the drafts map would repaint the full
    // replacement text on it.
    expect(runs[0]?.id).not.toBe('p1-r')
    expect(runs[2]?.id).not.toBe('p1-r')
    expect(
      runs[1]?.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:drawing'),
      ),
    ).toBe(true)
  })

  it('splices a second image after the first at one offset', () => {
    const base = model([paragraph('p1', 'text')])
    const folded = withStructuralDrafts(base, [
      imageDraft('s1', 'p1', 2),
      imageDraft('s2', 'p1', 2),
    ])
    const fragments = folded.stories[0]?.paragraphs.flatMap(paragraphImageXml)
    expect(fragments).toHaveLength(2)
    expect(folded.relationships).toHaveLength(2)
    expect(new Set(folded.relationships.map((wire) => wire.id)).size).toBe(2)
  })
})

describe('structural draft persistence', () => {
  it('round-trips both kinds through the schema the store parses', () => {
    const structures = [tableDraft('s1', 'p1'), imageDraft('s2', 'p1', 3)]
    const parsed = structures.map(
      (item) => structuralDraftSchema.safeParse(item).success,
    )
    expect(parsed).toEqual([true, true])
  })

  it('round-trips through storage with older drafts defaulting empty', () => {
    const storage = new MapStorage()
    const state: DraftState = {
      ...emptyDraftState(),
      structures: [tableDraft('s1', 'p1'), imageDraft('s2', 'p1', 3)],
    }
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_1',
        state,
        held: [],
      }),
    ).toBe(true)
    const restored = readDocumentDraft(storage, scope, 'ver_1')
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') throw new Error('expected restored')
    expect(restored.state.structures).toEqual(state.structures)
  })

  it('drops only a malformed structure slot and keeps the text drafts', () => {
    const storage = new MapStorage()
    const state = {
      ...emptyDraftState(),
      drafts: { 'p1-r': 'typed text' },
      structures: [
        tableDraft('s1', 'p1'),
        // A malformed slot: the dimension bound was not enforced when this
        // payload was written. It must not take the typed draft down with it.
        { ...imageDraft('s2', 'p1', 3), heightPx: 12_000_000 },
      ],
    }
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_1',
        state,
        held: [],
      }),
    ).toBe(true)
    const restored = readDocumentDraft(storage, scope, 'ver_1')
    if (restored.status !== 'restored') throw new Error('expected restored')
    expect(restored.state.drafts).toEqual({ 'p1-r': 'typed text' })
    expect(restored.state.structures).toEqual([state.structures[0]])
  })
})

describe('structural save planning', () => {
  it('emits structure operations after paragraph work and before deletes', () => {
    const plan = planDocumentSave(model([paragraph('p1'), paragraph('p2')]), {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'New' }],
      structures: [tableDraft('s1', 'p1'), imageDraft('s2', 'p2', 1)],
      deletedParagraphIds: ['p2'],
    })
    const types = plan.operations.map((operation) => operation.type)
    // The image anchors a paragraph the same batch deletes, so it is held
    // back rather than silently dropped; the table and the insert save.
    expect(types).toEqual([
      'insert_paragraph_after',
      'insert_table',
      'delete_paragraph',
    ])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.covered.map((slot) => slot.kind)).toContain('structure')
  })

  it('blocks a structure on a missing or deleted anchor', () => {
    const plan = planDocumentSave(model([paragraph('p1')]), {
      ...emptyDraftState(),
      structures: [tableDraft('s1', 'gone')],
    })
    expect(plan.operations).toEqual([])
    expect(plan.blocked[0]?.slot).toMatchObject({
      kind: 'structure',
      structureKind: 'table',
    })
    expect(plan.covered).toEqual([])
  })

  it('emits a mark_defined_term operation for a body-anchored mark', () => {
    const plan = planDocumentSave(model([paragraph('p1')]), {
      ...emptyDraftState(),
      structures: [definedTermDraft('s1', 'p1', 0, 4)],
    })
    expect(plan.operations).toEqual([
      { type: 'mark_defined_term', paragraphId: 'p1', from: 0, to: 4 },
    ])
    expect(plan.blocked).toEqual([])
  })

  it('blocks a defined-term mark anchored outside the body', () => {
    const base = model([paragraph('p1')])
    const footnoteStory: DocumentModelWire = {
      ...base,
      stories: [
        ...base.stories,
        {
          partName: 'word/footnotes.xml',
          kind: 'footnotes',
          paragraphs: [paragraph('fn1')],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
    }
    const plan = planDocumentSave(footnoteStory, {
      ...emptyDraftState(),
      structures: [definedTermDraft('s1', 'fn1')],
    })
    expect(plan.operations).toEqual([])
    expect(plan.blocked[0]?.slot).toMatchObject({
      kind: 'structure',
      structureKind: 'defined-term',
    })
    expect(plan.blocked[0]?.reason).toContain('body')
  })

  it('blocks a structure on a runless paragraph being replaced by text', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      extraRuns: {
        p1: [{ id: 'e1', text: 'typed', preservedXmlFragments: [] }],
      },
      structures: [tableDraft('s1', 'p1')],
    }
    const plan = planDocumentSave(
      model([paragraph('p1', ''), paragraph('p2')]),
      state,
    )
    // The anchor is deleted and reinserted by the same batch, so the
    // structural insertion cannot ride it — it is held back honestly.
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      'insert_paragraph_after',
      'delete_paragraph',
    ])
  })

  it('names, counts, clears and splits structure slots', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      structures: [tableDraft('s1', 'p1'), imageDraft('s2', 'p1', 2)],
    }
    expect(hasDraftState(state)).toBe(true)
    const slot: DraftSlot = {
      kind: 'structure',
      key: 'structure:s1',
      id: 's1',
      structureKind: 'table',
    }
    expect(slotLabel(slot)).toBe('a table')
    expect(clearableSlots([slot], state, state)).toEqual([slot])
    const remaining = removeDraftSlots(state, [slot])
    expect(remaining.structures.map((item) => item.id)).toEqual(['s2'])
  })
})

describe('documentStructureToolbar', () => {
  const cellModel = () => {
    const story = requiredStory(model([]))
    return {
      ...model([]),
      stories: [
        {
          ...story,
          paragraphs: [paragraph('para-w14-AABB0001', '', 'AABB0001')],
          preservedXmlFragments: [
            '<w:tbl><w:tr><w:tc><w:p w14:paraId="AABB0001"/></w:tc></w:tr></w:tbl>',
          ],
        },
      ],
    }
  }

  const toolbar = (
    overrides: Partial<Parameters<typeof documentStructureToolbar>[0]> = {},
  ) => {
    const structures: StructuralDraft[] = []
    const baseModel = model([paragraph('p1')])
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

  it('enables both controls on a stored body paragraph', () => {
    const { api, structures } = toolbar()
    expect(api.tableUnavailable).toBeUndefined()
    expect(api.pictureUnavailable).toBeUndefined()
    api.insertTable(2, 3)
    api.insertImage({
      contentType: 'image/png',
      dataBase64: PNG_BASE64,
      widthPx: 10,
      heightPx: 10,
      name: 'Figure',
    })
    expect(structures.map((item) => item.kind)).toEqual(['table', 'image'])
    expect(structures[0]).toMatchObject({ rows: 2, columns: 3 })
    expect(structures[1]).toMatchObject({ offset: 2 })
  })

  it('holds a defined-term mark over a nameable selection', () => {
    const baseModel = model([paragraph('p1', 'The Hourly Rate applies')])
    const { api, structures } = toolbar({
      model: baseModel,
      selectionActive: true,
      selectionRange: { paragraphId: 'p1', from: 4, to: 15 },
    })
    expect(api.definedTermUnavailable).toBeUndefined()
    expect(api.markDefinedTerm()).toEqual({ inserted: true })
    expect(structures).toEqual([
      expect.objectContaining({
        kind: 'defined-term',
        paragraphId: 'p1',
        from: 4,
        to: 15,
        marked: 'Hourly Rate',
      }),
    ])
  })

  it('refuses a defined-term mark with a reason the ribbon can show', () => {
    expect(
      toolbar({ selectionActive: true, selectionRange: null }).api
        .definedTermUnavailable,
    ).toBeTruthy()
    expect(
      toolbar({
        trackChanges: true,
        selectionRange: { paragraphId: 'p1', from: 0, to: 4 },
      }).api.definedTermUnavailable,
    ).toContain('tracked')
    // A selection whose text cannot name a term is refused with a reason.
    const unnameable = toolbar({
      model: model([paragraph('p1', '— — —')]),
      selectionActive: true,
      selectionRange: { paragraphId: 'p1', from: 0, to: 5 },
    })
    expect(unnameable.api.markDefinedTerm().inserted).toBe(false)
    expect(unnameable.structures).toEqual([])
  })

  it('refuses a splice inside a run a pending mark cuts, not inside a covered one', () => {
    // Runs 'aaaa' 'bbbb' 'cccc': the mark [4,11) covers run 2 whole and cuts
    // run 3. A field inside run 2 composes; inside run 3 it cannot fold.
    const multi = model([
      {
        id: 'p1',
        runs: [
          { id: 'r1', text: 'aaaa', preservedXmlFragments: [] },
          { id: 'r2', text: 'bbbb', preservedXmlFragments: [] },
          { id: 'r3', text: 'cccc', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
      paragraph('p2', 'target'),
    ])
    const held = [definedTermDraft('s1', 'p1', 4, 11)]
    const inside = toolbar({
      model: multi,
      structures: held,
      offset: 9,
    })
    expect(inside.api.crossReferenceUnavailable).toContain('defined-term')
    const coveredOnly = toolbar({
      model: multi,
      structures: [definedTermDraft('s1', 'p1', 4, 11)],
      offset: 6,
    })
    expect(coveredOnly.api.crossReferenceUnavailable).toBeUndefined()
  })

  it('refuses a second mark sharing a covered run but allows disjoint runs', () => {
    const multi = model([
      {
        id: 'p1',
        runs: [
          { id: 'r1', text: 'aaaa', preservedXmlFragments: [] },
          { id: 'r2', text: 'bbbb', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
    ])
    // A second mark inside the first mark's run writes an overlapping
    // replacement; one over the other run composes.
    const shared = toolbar({
      model: multi,
      structures: [definedTermDraft('s1', 'p1', 0, 2)],
      selectionActive: true,
      selectionRange: { paragraphId: 'p1', from: 2, to: 4 },
    })
    expect(shared.api.definedTermUnavailable).toContain('defined-term')
    const disjoint = toolbar({
      model: multi,
      structures: [definedTermDraft('s1', 'p1', 0, 2)],
      selectionActive: true,
      selectionRange: { paragraphId: 'p1', from: 4, to: 8 },
    })
    expect(disjoint.api.definedTermUnavailable).toBeUndefined()
  })

  it('refuses honestly when tracking, selecting, or unanchored', () => {
    expect(toolbar({ trackChanges: true }).api.tableUnavailable).toContain(
      'tracked',
    )
    expect(toolbar({ selectionActive: true }).api.pictureUnavailable).toContain(
      'selection',
    )
    expect(toolbar({ paragraphId: null }).api.tableUnavailable).toBeTruthy()
    expect(
      toolbar({ paragraphId: 'pending_1' }).api.tableUnavailable,
    ).toContain('Save the new paragraph')
    expect(toolbar({ offset: null }).api.pictureUnavailable).toBeTruthy()
  })

  it('refuses a table inside a table cell but not a picture', () => {
    const cells = cellModel()
    const { api } = toolbar({
      paragraphId: 'para-w14-AABB0001',
      model: cells,
      cellParagraphIds: storyTableCellIds(documentStory(cells)),
    })
    expect(api.tableUnavailable).toContain('cell')
    expect(api.pictureUnavailable).toBeUndefined()
  })

  it('refuses a picture whose fields build an invalid draft', () => {
    const { api, structures } = toolbar()
    const outcome = api.insertImage({
      contentType: 'image/png',
      dataBase64: PNG_BASE64,
      widthPx: 0,
      heightPx: 10,
      name: 'Figure',
    })
    expect(outcome).toEqual({
      inserted: false,
      reason: 'That image cannot be held as a draft.',
    })
    expect(structures).toEqual([])
  })
})

describe('scaleImageInsertSize', () => {
  it('clamps both dimensions to the contract maximum', () => {
    // The 1×20000 regression: scaling to the page column does not shrink the
    // height, so it must be clamped on its own.
    expect(scaleImageInsertSize(1, 20_000)).toEqual({
      widthPx: 1,
      heightPx: DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
    })
    expect(scaleImageInsertSize(1200, 800)).toEqual({
      widthPx: 600,
      heightPx: 400,
    })
    // Every admitted size still parses as a draft.
    for (const size of [
      scaleImageInsertSize(1, 20_000),
      scaleImageInsertSize(1200, 800),
    ]) {
      expect(
        structuralDraftSchema.safeParse({
          ...imageDraft('s1', 'p1', 0),
          ...size,
        }).success,
      ).toBe(true)
    }
  })
})
