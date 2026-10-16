import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import { findInDocument, type FindHit } from './document-find'
import { replaceFindHits } from './document-find-replace'
import { insertPlainText } from './document-edits'
import { blockText, emptyEditorState } from './document-word-edits'

const paragraph = (
  id: string,
  text: string,
  run?: Partial<DocumentParagraphWire['runs'][number]>,
): DocumentParagraphWire => ({
  id,
  runs: [{ id: `${id}-r`, text, preservedXmlFragments: [], ...run }],
  preservedXmlFragments: [],
})

const story = (
  paragraphs: DocumentParagraphWire[],
  fields: DocumentStoryWire['fields'] = [],
): DocumentStoryWire => ({
  partName: 'word/document.xml',
  kind: 'document',
  paragraphs,
  preservedXmlFragments: [],
  fields,
  unanchoredFieldParagraphIds: [],
})

const base = (
  paragraphs: DocumentParagraphWire[],
  fields: DocumentStoryWire['fields'] = [],
): DocumentModelWire => ({
  version: 1,
  stories: [story(paragraphs, fields)],
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
})

const twoParagraphs = base([paragraph('p1', 'Hello'), paragraph('p2', 'World')])

const hit = (from: [string, number], to: [string, number]): FindHit => ({
  from: { paragraphId: from[0], offset: from[1] },
  to: { paragraphId: to[0], offset: to[1] },
  segments: [],
})

let sequence = 0
const newId = () => `ins-${(sequence += 1)}`

describe('replaceFindHits', () => {
  it('replaces one hit or all hits inside a paragraph', () => {
    const one = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [hit(['p1', 0], ['p1', 5])],
      'Hi',
      0,
      newId,
    )
    expect(one.status === 'applied' && one.state.drafts['p1-r']).toBe('Hi')
    const all = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [hit(['p1', 1], ['p1', 2]), hit(['p1', 3], ['p1', 4])],
      '-',
      'all',
      newId,
    )
    expect(all.status === 'applied' && all.state.drafts['p1-r']).toBe('H-l-o')
  })

  it('replaces a folded Greek hit at its real range', () => {
    // The hit the fold derives must rewrite the stored letters, not the
    // folded ones — 'οδος' matches 'ΟΔΟΣ' and the replacement lands where
    // the stored word sits.
    const greek = base([paragraph('p1', 'Η ΟΔΟΣ κλείνει')])
    const state = emptyEditorState()
    const hits = findInDocument(greek, state, 'οδος')
    expect(hits).toHaveLength(1)
    const result = replaceFindHits(greek, state, hits, 'ΠΟΛΗ', 'all', newId)
    if (result.status !== 'applied') throw new Error('expected applied')
    expect(blockText(greek, result.state, 'p1')).toBe('Η ΠΟΛΗ κλείνει')
    expect(result.caret).toEqual({ paragraphId: 'p1', offset: 6 })
  })

  it('reports an empty outcome for a hit index that does not exist', () => {
    const result = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [hit(['p1', 0], ['p1', 2])],
      'x',
      4,
      newId,
    )
    expect(result.status).toBe('empty')
  })

  it('joins a hit that covers a paragraph break into one paragraph', () => {
    const spread = base([
      paragraph('p1', 'Hello world'),
      paragraph('p2', 'Hello again'),
    ])
    const result = replaceFindHits(
      spread,
      emptyEditorState(),
      [hit(['p1', 6], ['p2', 5])],
      'done',
      0,
      newId,
    )
    if (result.status !== 'applied') throw new Error('expected applied')
    // 'Hello ' + 'done' + ' again': the break is covered by the hit, so the
    // paragraphs join — the same range a cross-paragraph selection replace
    // produces.
    expect(blockText(spread, result.state, 'p1')).toBe('Hello done again')
    expect(result.state.deletedParagraphIds).toEqual(['p2'])
    expect(result.caret).toEqual({ paragraphId: 'p1', offset: 10 })
  })

  it('replaces every hit atomically, validating before the first write', () => {
    // The second hit's tail carries a character style the save cannot
    // restate over a join, so the whole batch must refuse — and nothing may
    // have changed.
    const styled = base([
      paragraph('p1', 'Alpha end'),
      paragraph('p2', 'start beta', { styleId: 'Emphasis' }),
    ])
    const hits = [hit(['p1', 0], ['p1', 5]), hit(['p1', 6], ['p2', 5])]
    const state = emptyEditorState()
    const result = replaceFindHits(styled, state, hits, 'x', 'all', newId)
    expect(result.status === 'refused' && result.refusal).toBe(
      'join-formatting',
    )
    expect(state).toEqual(emptyEditorState())
  })

  it('refuses a batch whose range splits a stored field boundary', () => {
    const fielded = base(
      [
        paragraph('p1', 'Alpha end'),
        paragraph('p2', 'start beta'),
        paragraph('p3', 'tail'),
      ],
      [
        {
          headId: 'p2',
          tailId: 'p3',
          closed: true,
          boundaryIds: ['p2', 'p3'],
          paragraphIds: ['p2', 'p3'],
          resultIds: ['p2'],
          instruction: ' REF _Ref1 ',
          rangeReplaceable: false,
          boundariesAnchored: true,
        },
      ],
    )
    const hits = [hit(['p1', 6], ['p2', 5])]
    const state = emptyEditorState()
    const result = replaceFindHits(fielded, state, hits, 'x', 'all', newId)
    expect(result.status === 'refused' && result.refusal).toBe('structure')
    expect(state).toEqual(emptyEditorState())
  })

  it('replaces into a pending insert the same as a stored paragraph', () => {
    const state = {
      ...emptyEditorState(),
      inserts: [
        {
          clientId: 'ins1',
          afterParagraphId: 'p1',
          text: 'Inserted text',
        },
      ],
    }
    const result = replaceFindHits(
      twoParagraphs,
      state,
      [hit(['ins1', 0], ['ins1', 8])],
      'Draft',
      0,
      newId,
    )
    if (result.status !== 'applied') throw new Error('expected applied')
    const insert = result.state.inserts.find((item) => item.clientId === 'ins1')
    expect(insert ? insertPlainText(insert) : '').toBe('Draft text')
  })

  it('splits paragraphs for a replacement containing a line ending', () => {
    const result = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [hit(['p1', 0], ['p1', 5])],
      'First\nSecond',
      0,
      newId,
    )
    if (result.status !== 'applied') throw new Error('expected applied')
    expect(blockText(twoParagraphs, result.state, 'p1')).toBe('First')
    const inserts = result.state.inserts.map(insertPlainText)
    expect(inserts).toContain('Second')
  })
})
