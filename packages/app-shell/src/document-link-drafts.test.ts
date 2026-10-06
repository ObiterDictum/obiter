import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { MapStorage, scope } from './document-draft-store-test-support'
import { readDocumentDraft, writeDocumentDraft } from './document-draft-store'
import { documentStory } from './document-model-text'
import { withStructuralDrafts } from './document-structure-fold'
import {
  documentStructureToolbar,
  storyTableCellIds,
} from './document-structure-toolbar'
import {
  structuralDraftSchema,
  structuralLinkOverlays,
  type StructuralCrossReferenceDraft,
  type StructuralDraft,
  type StructuralLinkDraft,
} from './document-structural-drafts'
import {
  emptyDraftState,
  planDocumentSave,
  slotLabel,
  type DraftState,
  type DraftSlot,
} from './document-save-plan'

function paragraph(id: string, text = 'text'): DocumentParagraphWire {
  return {
    id,
    runs: text ? [{ id: `${id}-r`, text, preservedXmlFragments: [] }] : [],
    preservedXmlFragments: [],
  }
}

/** 'See <the report> today' with the stored link covering the middle run. */
function linkedParagraph(): DocumentParagraphWire {
  return {
    id: 'p1',
    runs: [
      { id: 'p1-a', text: 'See ', preservedXmlFragments: [] },
      {
        id: 'p1-b',
        text: 'the report',
        preservedXmlFragments: [],
        hyperlinkTarget: 'https://example.co.uk/report',
      },
      { id: 'p1-c', text: ' today', preservedXmlFragments: [] },
    ],
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
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

const linkDraft = (
  id: string,
  paragraphId: string,
  target = 'https://example.com',
): StructuralLinkDraft => ({
  id,
  kind: 'link',
  paragraphId,
  from: 1,
  to: 4,
  target,
})

const crossReferenceDraft = (
  id: string,
  paragraphId: string,
  targetParagraphId: string,
): StructuralCrossReferenceDraft => ({
  id,
  kind: 'cross-reference',
  paragraphId,
  offset: 2,
  targetParagraphId,
})

describe('link and cross-reference drafts', () => {
  it('parses both kinds and refuses an unsafe or empty-ranged link', () => {
    expect(structuralDraftSchema.safeParse(linkDraft('s1', 'p1')).success).toBe(
      true,
    )
    expect(
      structuralDraftSchema.safeParse(crossReferenceDraft('s2', 'p1', 'p2'))
        .success,
    ).toBe(true)
    expect(
      structuralDraftSchema.safeParse(
        linkDraft('s3', 'p1', 'javascript:alert(1)'),
      ).success,
    ).toBe(false)
    expect(
      structuralDraftSchema.safeParse(linkDraft('s4', 'p1', 'data:text/html,x'))
        .success,
    ).toBe(false)
    expect(
      structuralDraftSchema.safeParse({
        ...linkDraft('s5', 'p1'),
        from: 4,
        to: 1,
      }).success,
    ).toBe(false)
  })

  it('emits the save operations the covered drafts carry', () => {
    const plan = planDocumentSave(model([paragraph('p1'), paragraph('p2')]), {
      ...emptyDraftState(),
      structures: [
        linkDraft('s1', 'p1'),
        crossReferenceDraft('s2', 'p2', 'p1'),
      ],
    })
    expect(plan.operations).toEqual([
      {
        type: 'set_hyperlink',
        paragraphId: 'p1',
        from: 1,
        to: 4,
        target: 'https://example.com',
      },
      {
        type: 'insert_cross_reference',
        paragraphId: 'p2',
        offset: 2,
        targetParagraphId: 'p1',
      },
    ])
    expect(plan.blocked).toEqual([])
  })

  it('blocks a cross-reference whose target is gone or deleted', () => {
    const base = model([paragraph('p1'), paragraph('p2')])
    const missing = planDocumentSave(base, {
      ...emptyDraftState(),
      structures: [crossReferenceDraft('s1', 'p1', 'gone')],
    })
    expect(missing.operations).toEqual([])
    expect(missing.blocked[0]?.slot).toMatchObject({
      kind: 'structure',
      structureKind: 'cross-reference',
    })
    expect(missing.blocked[0]?.reason).toContain('references')

    const deleted = planDocumentSave(base, {
      ...emptyDraftState(),
      structures: [crossReferenceDraft('s1', 'p1', 'p2')],
      deletedParagraphIds: ['p2'],
    })
    // The deletion itself still saves; only the reference pointing at the
    // deleted paragraph is held back.
    expect(deleted.operations.map((operation) => operation.type)).toEqual([
      'delete_paragraph',
    ])
    expect(deleted.blocked.map((item) => item.slot)).toEqual([
      expect.objectContaining({ structureKind: 'cross-reference' }),
    ])
  })

  it('blocks a second structural draft a writer cannot compose in the same run', () => {
    const base = model([
      paragraph('p1', 'See the cited sections'),
      paragraph('p2', 'Target'),
    ])
    const link = linkDraft('s1', 'p1') // covers [1,4) of the single run
    const cases: Array<{ name: string; structures: StructuralDraft[] }> = [
      {
        name: 'a second link in the same run',
        structures: [
          link,
          {
            ...linkDraft('s2', 'p1', 'https://other.example.com'),
            from: 10,
            to: 15,
          },
        ],
      },
      {
        name: 'a picture inside the linked run',
        structures: [
          link,
          {
            id: 's2',
            kind: 'image',
            paragraphId: 'p1',
            offset: 8,
            contentType: 'image/png',
            dataBase64: 'aGk=',
            widthPx: 4,
            heightPx: 4,
            name: 'x.png',
          },
        ],
      },
      {
        name: 'a cross-reference inside the linked run',
        structures: [link, crossReferenceDraft('s2', 'p1', 'p2')],
      },
      {
        name: 'a second cross-reference in the same run',
        structures: [
          crossReferenceDraft('s1', 'p1', 'p2'),
          { ...crossReferenceDraft('s2', 'p1', 'p2'), offset: 10 },
        ],
      },
    ]
    for (const { name, structures } of cases) {
      const plan = planDocumentSave(base, { ...emptyDraftState(), structures })
      expect(
        plan.blocked.map((item) => item.slot),
        name,
      ).toEqual([expect.objectContaining({ kind: 'structure', id: 's2' })])
      expect(plan.blocked[0]?.reason, name).toBeTruthy()
      // The surviving draft still saves.
      expect(plan.operations).toHaveLength(1)
    }
  })

  it('keeps composable same-paragraph structural drafts addressable', () => {
    // Two runs: 'See ' (0-4) and 'sections' (4-12).
    const base = model([
      {
        id: 'p1',
        runs: [
          { id: 'p1-a', text: 'See ', preservedXmlFragments: [] },
          { id: 'p1-b', text: 'sections', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
      paragraph('p2', 'Target'),
      paragraph('p3', 'Other'),
    ])
    const link = { ...linkDraft('s1', 'p1'), from: 0, to: 3 }
    const cases: Array<{ name: string; structures: StructuralDraft[] }> = [
      {
        name: 'a cross-reference in an uncovered run',
        structures: [
          link,
          { ...crossReferenceDraft('s2', 'p1', 'p2'), offset: 8 },
        ],
      },
      {
        name: 'a picture then a cross-reference',
        structures: [
          {
            id: 's1',
            kind: 'image',
            paragraphId: 'p1',
            offset: 2,
            contentType: 'image/png',
            dataBase64: 'aGk=',
            widthPx: 4,
            heightPx: 4,
            name: 'x.png',
          },
          { ...crossReferenceDraft('s2', 'p1', 'p2'), offset: 8 },
        ],
      },
      {
        name: 'links on disjoint runs',
        structures: [
          link,
          {
            ...linkDraft('s2', 'p1', 'https://other.example.com'),
            from: 5,
            to: 10,
          },
        ],
      },
      {
        name: 'cross-references in disjoint runs',
        structures: [
          { ...crossReferenceDraft('s1', 'p1', 'p2'), offset: 1 },
          { ...crossReferenceDraft('s2', 'p1', 'p3'), offset: 8 },
        ],
      },
      {
        name: 'two references to one target from different paragraphs',
        structures: [
          crossReferenceDraft('s1', 'p1', 'p3'),
          crossReferenceDraft('s2', 'p2', 'p3'),
        ],
      },
    ]
    for (const { name, structures } of cases) {
      const plan = planDocumentSave(base, { ...emptyDraftState(), structures })
      expect(plan.blocked, name).toEqual([])
      expect(
        plan.operations.map((operation) => operation.type),
        name,
      ).toHaveLength(2)
    }
  })

  it('blocks a splice drafted inside a stored hyperlink', () => {
    // 'See ' [0,4) 'the report' [4,14) ' today' [14,20): the stored link
    // covers the middle run, so 8 nests inside it and 2 lands before it.
    const base = model([linkedParagraph(), paragraph('p2', 'Target')])
    const nested = planDocumentSave(base, {
      ...emptyDraftState(),
      structures: [{ ...crossReferenceDraft('s1', 'p1', 'p2'), offset: 8 }],
    })
    expect(nested.blocked.map((item) => item.slot)).toEqual([
      expect.objectContaining({ kind: 'structure', id: 's1' }),
    ])
    expect(nested.blocked[0]?.reason).toContain('hyperlink')
    expect(nested.operations).toEqual([])

    const outside = planDocumentSave(base, {
      ...emptyDraftState(),
      structures: [{ ...crossReferenceDraft('s1', 'p1', 'p2'), offset: 2 }],
    })
    expect(outside.blocked).toEqual([])
    expect(outside.operations.map((operation) => operation.type)).toEqual([
      'insert_cross_reference',
    ])
  })

  it('names link and cross-reference slots for disclosure', () => {
    const link: DraftSlot = {
      kind: 'structure',
      key: 'structure:s1',
      id: 's1',
      structureKind: 'link',
    }
    const reference: DraftSlot = {
      kind: 'structure',
      key: 'structure:s2',
      id: 's2',
      structureKind: 'cross-reference',
    }
    expect(slotLabel(link)).toBe('a hyperlink')
    expect(slotLabel(reference)).toBe('a cross-reference')
  })

  it('drops only a malformed link slot on restore, keeping its siblings', () => {
    const storage = new MapStorage()
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { 'p1-r': 'typed text' },
      structures: [
        linkDraft('s1', 'p1'),
        crossReferenceDraft('s2', 'p1', 'p2'),
        // A malformed slot: the scheme bound was not enforced when this
        // payload was written. It must not take siblings or text down.
        linkDraft('s3', 'p1', 'javascript:alert(1)'),
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
    expect(restored.state.structures).toEqual([
      state.structures[0],
      state.structures[1],
    ])
  })

  it('folds no model change for either kind', () => {
    const base = model([paragraph('p1'), paragraph('p2')])
    const folded = withStructuralDrafts(base, [
      linkDraft('s1', 'p1'),
      crossReferenceDraft('s2', 'p1', 'p2'),
    ])
    expect(folded).toBe(base)
  })

  it('groups overlays by paragraph and labels markers with the target text', () => {
    const base = model([
      paragraph('p1', 'See section two.'),
      paragraph('p2', 'Second section'),
    ])
    const overlays = structuralLinkOverlays(base, [
      linkDraft('s1', 'p1'),
      crossReferenceDraft('s2', 'p1', 'p2'),
      crossReferenceDraft('s3', 'p2', 'p1'),
    ])
    const first = overlays.get('p1')
    expect(first?.links).toEqual([
      { from: 1, to: 4, target: 'https://example.com' },
    ])
    expect(first?.fieldMarkers).toEqual([
      { offset: 2, label: 'Second section' },
    ])
    expect(overlays.get('p2')?.links).toEqual([])
    expect(overlays.get('p2')?.fieldMarkers).toEqual([
      { offset: 2, label: 'See section two.' },
    ])
  })

  it('labels a vanished target differently from a genuinely empty one', () => {
    const base = model([paragraph('p1'), paragraph('p2', '')])
    const overlays = structuralLinkOverlays(base, [
      crossReferenceDraft('s1', 'p1', 'gone'),
      crossReferenceDraft('s2', 'p1', 'p2'),
    ])
    expect(overlays.get('p1')?.fieldMarkers).toEqual([
      { offset: 2, label: '(target no longer in the document)' },
      { offset: 2, label: '(empty paragraph)' },
    ])
  })
})

describe('documentStructureToolbar links', () => {
  const toolbar = (
    overrides: Partial<Parameters<typeof documentStructureToolbar>[0]> = {},
  ) => {
    const structures: StructuralDraft[] = []
    const baseModel = model([paragraph('p1', 'Hello'), paragraph('p2')])
    const api = documentStructureToolbar({
      paragraphId: 'p1',
      model: baseModel,
      cellParagraphIds: storyTableCellIds(documentStory(baseModel)),
      offset: 2,
      selectionActive: true,
      selectionRange: { paragraphId: 'p1', from: 1, to: 4 },
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

  it('holds a hyperlink draft over the selected range', () => {
    const { api, structures } = toolbar()
    expect(api.linkUnavailable).toBeUndefined()
    expect(api.insertLink('https://example.com')).toEqual({ inserted: true })
    expect(structures).toEqual([
      {
        id: expect.any(String),
        kind: 'link',
        paragraphId: 'p1',
        from: 1,
        to: 4,
        target: 'https://example.com',
      },
    ])
  })

  it('refuses a link without a single-paragraph selection', () => {
    expect(toolbar({ selectionRange: null }).api.linkUnavailable).toContain(
      'one paragraph',
    )
    expect(
      toolbar({ selectionActive: false, selectionRange: null }).api
        .linkUnavailable,
    ).toContain('Select the text')
    expect(toolbar({ trackChanges: true }).api.linkUnavailable).toContain(
      'tracked',
    )
    expect(
      toolbar({
        selectionRange: { paragraphId: 'pending_1', from: 0, to: 2 },
      }).api.linkUnavailable,
    ).toContain('Save the new paragraph')
  })

  it('refuses an unsafe address rather than drafting it', () => {
    const { api, structures } = toolbar()
    expect(api.insertLink('javascript:alert(1)')).toEqual({
      inserted: false,
      reason: 'Enter an http, https or mailto address.',
    })
    expect(structures).toEqual([])
  })

  it('holds a cross-reference draft and lists live targets', () => {
    const { api, structures } = toolbar({
      selectionActive: false,
      selectionRange: null,
    })
    expect(api.crossReferenceUnavailable).toBeUndefined()
    expect(api.crossReferenceTargets.map((item) => item.id)).toEqual(['p2'])
    expect(api.insertCrossReference('p2')).toEqual({ inserted: true })
    expect(structures).toEqual([
      {
        id: expect.any(String),
        kind: 'cross-reference',
        paragraphId: 'p1',
        offset: 2,
        targetParagraphId: 'p2',
      },
    ])
  })

  it('refuses a cross-reference under a selection or tracked changes', () => {
    expect(
      toolbar({ trackChanges: true }).api.crossReferenceUnavailable,
    ).toBeTruthy()
    // A selection gives the insertion no caret, even though a link could
    // still cover the same range.
    const { api } = toolbar()
    expect(api.crossReferenceUnavailable).toContain('Collapse the selection')
    expect(api.insertCrossReference('p2').inserted).toBe(false)
  })

  it('refuses a target the chooser does not list', () => {
    const { api, structures } = toolbar({
      selectionActive: false,
      selectionRange: null,
    })
    expect(api.insertCrossReference('gone')).toEqual({
      inserted: false,
      reason: 'That reference target is no longer available.',
    })
    expect(structures).toEqual([])
  })

  it('hides a paragraph marked for deletion from the chooser', () => {
    const { api } = toolbar({ deletedParagraphIds: new Set(['p2']) })
    expect(api.crossReferenceTargets.map((item) => item.id)).toEqual([])
  })

  it('never offers the host paragraph as its own target', () => {
    const { api, structures } = toolbar({
      selectionActive: false,
      selectionRange: null,
    })
    expect(api.crossReferenceTargets.some((target) => target.id === 'p1')).toBe(
      false,
    )
    expect(api.insertCrossReference('p1')).toEqual({
      inserted: false,
      reason: 'A reference cannot point at the paragraph holding it.',
    })
    expect(structures).toEqual([])
  })

  it('refuses a second structural draft the writers cannot compose', () => {
    // The held link covers p1's whole single run, so a caret inside it is
    // unavailable to a picture or a cross-reference.
    const { api, structures } = toolbar({
      structures: [linkDraft('s1', 'p1')],
      offset: 3,
      selectionActive: false,
      selectionRange: null,
    })
    expect(api.pictureUnavailable).toContain('hyperlink')
    expect(api.crossReferenceUnavailable).toContain('hyperlink')
    expect(
      api.insertImage({
        contentType: 'image/png',
        dataBase64: 'aGk=',
        widthPx: 1,
        heightPx: 1,
        name: 'a.png',
      }).inserted,
    ).toBe(false)
    expect(api.insertCrossReference('p2').inserted).toBe(false)
    expect(structures).toEqual([])
  })

  it('refuses a splice inside a stored hyperlink, not beside it', () => {
    const linkedModel = model([linkedParagraph(), paragraph('p2')])
    const caret = { selectionActive: false, selectionRange: null }
    const inside = toolbar({ model: linkedModel, offset: 8, ...caret })
    expect(inside.api.pictureUnavailable).toContain('hyperlink')
    expect(inside.api.crossReferenceUnavailable).toContain('hyperlink')
    expect(inside.api.insertCrossReference('p2').inserted).toBe(false)
    const outside = toolbar({ model: linkedModel, offset: 2, ...caret })
    expect(outside.api.pictureUnavailable).toBeUndefined()
    expect(outside.api.crossReferenceUnavailable).toBeUndefined()
  })

  it('refuses a second link over a covered run', () => {
    const { api, structures } = toolbar({
      structures: [linkDraft('s1', 'p1')],
    })
    expect(api.linkUnavailable).toContain('hyperlink')
    expect(api.insertLink('https://example.com/other').inserted).toBe(false)
    expect(structures).toEqual([])
  })
})
