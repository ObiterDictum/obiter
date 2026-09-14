import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  clearableSlots,
  emptyDraftState,
  hasDraftState,
  planDocumentSave,
  removeDraftSlots,
  slotLabel,
  splitDraftSlots,
  type DraftState,
} from './document-save-plan'
import { emptyFormatDrafts } from './document-format-edits'

function model(
  paragraphIds: string[],
  runIds: string[] = [],
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphIds.map((id, index) => ({
          id,
          runs: runIds[index]
            ? [{ id: runIds[index], text: 'text', preservedXmlFragments: [] }]
            : [],
          preservedXmlFragments: [],
        })),
        preservedXmlFragments: [],
      },
    ],
    styles: [
      {
        styleId: 'Heading1',
        sourceFragment:
          '<w:style w:type="paragraph"><w:name w:val="Heading 1"/></w:style>',
      },
    ],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

describe('planDocumentSave addressability', () => {
  it('holds back a format draft aimed at a paragraph the model no longer has', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyFormatDrafts,
        paragraphStyles: { gone: 'Heading1' },
      },
    }
    const plan = planDocumentSave(model(['p1']), state)
    expect(plan.operations).toEqual([])
    expect(plan.blocked).toEqual([
      {
        slot: {
          kind: 'paragraph-style',
          key: 'style:gone',
          paragraphId: 'gone',
        },
        reason: 'This paragraph is no longer in the document.',
        label: 'a paragraph style',
      },
    ])
    expect(plan.covered).toEqual([])
  })

  it('folds a pending paragraph style into its insert instead of addressing the client id', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'ins_1', afterParagraphId: 'p1', text: 'New' }],
      format: {
        ...emptyFormatDrafts,
        paragraphStyles: { ins_1: 'Heading1' },
      },
    }
    const plan = planDocumentSave(model(['p1']), state)
    expect(plan.operations).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'New',
        styleId: 'Heading1',
      },
    ])
    expect(plan.blocked).toEqual([])
    // The style rides on the insert, so it is cleared with it.
    expect(plan.covered).toEqual([
      { kind: 'insert', key: 'insert:ins_1', clientId: 'ins_1' },
      {
        kind: 'paragraph-style',
        key: 'style:ins_1',
        paragraphId: 'ins_1',
      },
    ])
  })

  it('holds back typed text whose run is no longer in the model', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { gone: 'typed' },
    }
    const plan = planDocumentSave(model(['p1'], ['r1']), state)
    expect(plan.operations).toEqual([])
    expect(plan.blocked[0]?.label).toBe('typed text')
    expect(plan.covered).toEqual([])
  })

  it('reports covered slots for everything it can send', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'typed' },
      deletedParagraphIds: ['p2'],
    }
    const plan = planDocumentSave(model(['p1', 'p2'], ['r1']), state)
    expect(plan.operations).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'typed' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
    expect(plan.covered.map((slot) => slot.key)).toEqual([
      'run:r1',
      'delete:p2',
    ])
    expect(plan.blocked).toEqual([])
  })

  it('does not share format state between draft states', () => {
    const first = emptyDraftState()
    const second = emptyDraftState()
    expect(first.format).not.toBe(second.format)
    expect(first.format.paragraphStyles).not.toBe(second.format.paragraphStyles)

    const state: DraftState = {
      ...first,
      format: { ...emptyFormatDrafts, numbering: { p1: { numId: '1' } } },
    }
    planDocumentSave(model(['p1']), state)
    // Planning fills a working copy; it must not leave anything behind in the
    // module-level empty format that a second workspace would inherit.
    expect(second.format.numbering).toEqual({})
    expect(emptyFormatDrafts.numbering).toEqual({})
    expect(emptyFormatDrafts.paragraphStyles).toEqual({})
  })
})

describe('draft slot removal', () => {
  it('removes exactly the named slots and leaves the rest', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'one', r2: 'two' },
      inserts: [{ clientId: 'ins_1', afterParagraphId: 'p1', text: 'New' }],
      format: {
        ...emptyFormatDrafts,
        paragraphStyles: { p1: 'Heading1' },
      },
    }
    const plan = planDocumentSave(model(['p1'], ['r1', 'r2']), state)
    const withoutInsert = removeDraftSlots(
      state,
      plan.covered.filter((slot) => slot.kind === 'insert'),
    )
    expect(withoutInsert.inserts).toEqual([])
    expect(withoutInsert.drafts).toEqual({ r1: 'one', r2: 'two' })

    const withoutText = removeDraftSlots(
      state,
      plan.covered.filter((slot) => slot.key === 'run:r1'),
    )
    expect(withoutText.drafts).toEqual({ r2: 'two' })
  })

  it('returns the removed fragment so held work keeps its content', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'held text' },
    }
    const { remaining, removed } = splitDraftSlots(state, [
      { kind: 'run-text', key: 'run:r1', runId: 'r1' },
    ])
    expect(remaining.drafts).toEqual({})
    expect(removed.drafts).toEqual({ r1: 'held text' })
    expect(hasDraftState(removed)).toBe(true)
    expect(hasDraftState(remaining)).toBe(false)
  })

  it('names each slot so the disclosure is specific', () => {
    expect(slotLabel({ kind: 'run-text', key: 'k', runId: 'r' })).toBe(
      'typed text',
    )
    expect(slotLabel({ kind: 'delete', key: 'k', paragraphId: 'p' })).toBe(
      'a paragraph deletion',
    )
  })

  it('clears only slots that still hold what the request sent', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'sent', r2: 'also sent' },
    }
    const current: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'sent', r2: 'edited during the save' },
    }
    const covered = planDocumentSave(model(['p1'], ['r1', 'r2']), sent).covered
    expect(
      clearableSlots(covered, sent, current).map((slot) => slot.key),
    ).toEqual(['run:r1'])
  })
})
