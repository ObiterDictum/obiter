import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  findInDocument,
  findMatchLabel,
  nextFindIndex,
  previousFindIndex,
} from './document-find'
import {
  popWorkspaceDraft,
  pushWorkspaceDraft,
} from './document-editor-history'
import { emptyFormatDrafts } from './document-format-edits'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello world', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        {
          id: 'p2',
          runs: [{ id: 'r2', text: 'Hello again', preservedXmlFragments: [] }],
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

describe('find in document', () => {
  it('finds case-insensitive hits across paragraphs, drafts, and inserts', () => {
    expect(findInDocument(model, {}, [], [], 'hello')).toEqual([
      { paragraphId: 'p1', start: 0, end: 5 },
      { paragraphId: 'p2', start: 0, end: 5 },
    ])
    expect(
      findInDocument(model, { r1: 'Changed World' }, [], [], 'world'),
    ).toEqual([{ paragraphId: 'p1', start: 8, end: 13 }])
    expect(
      findInDocument(
        model,
        {},
        [{ clientId: 'ins1', afterParagraphId: 'p1', text: 'Hello insert' }],
        [],
        'insert',
      ),
    ).toEqual([{ paragraphId: 'ins1', start: 6, end: 12 }])
    expect(findInDocument(model, {}, [], ['p1'], 'hello')).toEqual([
      { paragraphId: 'p2', start: 0, end: 5 },
    ])
    expect(findInDocument(model, {}, [], [], '  ')).toEqual([])
  })

  it('wraps next and previous hit indexes', () => {
    const hits = findInDocument(model, {}, [], [], 'hello')
    expect(nextFindIndex(hits, -1)).toBe(0)
    expect(nextFindIndex(hits, 0)).toBe(1)
    expect(nextFindIndex(hits, 1)).toBe(0)
    expect(previousFindIndex(hits, 0)).toBe(1)
    expect(nextFindIndex([], 0)).toBe(-1)
    expect(findMatchLabel(-1, 0)).toBe('0 found')
    expect(findMatchLabel(-1, 2)).toBe('2 found')
    expect(findMatchLabel(0, 2)).toBe('1/2')
  })
})

describe('workspace draft history', () => {
  it('restores the last checkpoint and drops the oldest past 50', () => {
    const first = {
      drafts: { r1: 'A' },
      inserts: [],
      deletedParagraphIds: [],
      extraRuns: {},
      format: emptyFormatDrafts,
    }
    const second = { ...first, drafts: { r1: 'B' } }
    const stacked = pushWorkspaceDraft(pushWorkspaceDraft([], first), second)
    const undone = popWorkspaceDraft(stacked)
    expect(undone?.snapshot.drafts).toEqual({ r1: 'B' })
    expect(popWorkspaceDraft(undone?.history ?? [])?.snapshot.drafts).toEqual({
      r1: 'A',
    })
    expect(popWorkspaceDraft([])).toBeNull()

    let history = stacked
    for (let i = 0; i < 50; i += 1) {
      history = pushWorkspaceDraft(history, {
        ...first,
        drafts: { r1: `n${i}` },
      })
    }
    expect(history).toHaveLength(50)
    expect(history[0]?.drafts).toEqual({ r1: 'n0' })
    expect(history[49]?.drafts).toEqual({ r1: 'n49' })
  })

  it('clones checkpoints so later mutation does not rewrite history', () => {
    const snapshot = {
      drafts: { r1: 'A' },
      inserts: [],
      deletedParagraphIds: [],
      extraRuns: {},
      format: emptyFormatDrafts,
    }
    const history = pushWorkspaceDraft([], snapshot)
    snapshot.drafts.r1 = 'mutated'
    expect(history[0]?.drafts).toEqual({ r1: 'A' })
  })
})
