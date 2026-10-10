import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import {
  clampFindIndex,
  findInDocument,
  findInText,
  findMatchLabel,
  nextFindIndex,
  previousFindIndex,
  type FindHit,
} from './document-find'
import {
  popWorkspaceDraft,
  pushWorkspaceDraft,
} from './document-editor-history'
import { emptyFormatDrafts } from './document-format-edits'
import type { LocalInsert } from './document-edits'
import type { EditorState, ExtraRuns } from './document-word-edits'

const state = (
  drafts: Record<string, string> = {},
  inserts: LocalInsert[] = [],
  deletedParagraphIds: string[] = [],
  extraRuns: ExtraRuns = {},
): EditorState => ({ drafts, inserts, deletedParagraphIds, extraRuns })

const paragraph = (id: string, text: string): DocumentParagraphWire => ({
  id,
  runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
  preservedXmlFragments: [],
})

const story = (paragraphs: DocumentParagraphWire[]): DocumentStoryWire => ({
  partName: 'word/document.xml',
  kind: 'document',
  paragraphs,
  preservedXmlFragments: [],
  fields: [],
  unanchoredFieldParagraphIds: [],
})

const model: DocumentModelWire = {
  version: 1,
  stories: [
    story([paragraph('p1', 'Hello world'), paragraph('p2', 'Hello again')]),
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

/** The hit endpoints as plain tuples — an independent oracle of where the
 * range lands, not a re-run of the matching code. */
const ends = (hits: readonly FindHit[]) =>
  hits.map((hit) => [hit.from, hit.to] as const)

const OPTIONS = { matchCase: false, wholeWord: false }

describe('find in text', () => {
  it('matches literally, case-folded by default and case-sensitively on request', () => {
    expect(findInText('Hello hello HELLO', 'hello', OPTIONS)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ])
    expect(
      findInText('Hello hello HELLO', 'hello', {
        matchCase: true,
        wholeWord: false,
      }),
    ).toEqual([{ start: 6, end: 11 }])
  })

  it('never runs the needle as a pattern', () => {
    expect(findInText('a.b axb', 'a.b', OPTIONS)).toEqual([
      { start: 0, end: 3 },
    ])
    expect(findInText('a(b) aab', 'a(b)', OPTIONS)).toEqual([
      { start: 0, end: 4 },
    ])
  })

  it('lets query whitespace match a break, and matches a break literally', () => {
    expect(findInText('foo\nbar', 'foo bar', OPTIONS)).toEqual([
      { start: 0, end: 7 },
    ])
    expect(findInText('foo\nbar', ' ', OPTIONS)).toEqual([{ start: 3, end: 4 }])
    expect(findInText('foo\nbar', '\n', OPTIONS)).toEqual([
      { start: 3, end: 4 },
    ])
    expect(findInText('foo bar', 'foo  bar', OPTIONS)).toEqual([])
  })

  it('honours whole-word at both edges, including punctuation and breaks', () => {
    const whole = { matchCase: false, wholeWord: true }
    expect(findInText('concatenate cat', 'cat', whole)).toEqual([
      { start: 12, end: 15 },
    ])
    expect(findInText('cat, dog-cat', 'cat', whole)).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
    ])
    expect(findInText('cat\nend', 'cat', whole)).toEqual([{ start: 0, end: 3 }])
    // Non-ASCII punctuation and currency are boundaries, not word letters.
    expect(findInText('£cat—x', 'cat', whole)).toEqual([{ start: 1, end: 4 }])
    expect(findInText('cat5 _cat', 'cat', whole)).toEqual([])
  })

  it('folds and composes Unicode without splitting clusters', () => {
    // Decomposed 'e'+́ matches a composed query, covering both code units.
    expect(findInText('café au lait', 'café', OPTIONS)).toEqual([
      { start: 0, end: 5 },
    ])
    expect(findInText('café au lait', 'café', OPTIONS)).toEqual([
      { start: 0, end: 4 },
    ])
    // …but the accented letter is not the unaccented one.
    expect(findInText('café', 'cafe', OPTIONS)).toEqual([])
    // Astral code points are single letters: a hit covers both surrogate
    // units, and offsets stay UTF-16-exact around it.
    expect(findInText('a𝕏b', '𝕏', OPTIONS)).toEqual([{ start: 1, end: 3 }])
    expect(findInText('a𝕏b', 'b', OPTIONS)).toEqual([{ start: 3, end: 4 }])
    // Turkish İ folds to 'i' + combining dot: 'i' matches, and the hit maps
    // to the whole stored letter rather than half its fold.
    expect(findInText('İstanbul', 'i', OPTIONS)).toEqual([{ start: 0, end: 1 }])
    // …and a composed 'İ' query folds to the same two units, matching the
    // stored cluster but never a bare 'i' — the fold tail must participate.
    expect(findInText('İstanbul', 'İ', OPTIONS)).toEqual([{ start: 0, end: 1 }])
    expect(findInText('istanbul', 'İ', OPTIONS)).toEqual([])
    // Folding is locale-independent: dotless ı and I stay different letters.
    expect(findInText('istanbul', 'I', OPTIONS)).toEqual([{ start: 0, end: 1 }])
    expect(findInText('ıstanbul', 'I', OPTIONS)).toEqual([])
    // …and there is no multi-letter expansion: 'ß' is only 'ß', never 'ss'.
    expect(findInText('straße', 'ss', OPTIONS)).toEqual([])
    expect(findInText('strasse', 'ß', OPTIONS)).toEqual([])
  })

  it('folds the Greek final sigma the same on both sides', () => {
    // A case-insensitive query identical to the stored text must find it —
    // 'ΟΔΟΣ' ends in a sigma whose whole-string fold is 'ς' while a bare
    // cluster folds to 'σ', and the two sides once disagreed into a miss.
    expect(findInText('ΟΔΟΣ', 'ΟΔΟΣ', OPTIONS)).toEqual([{ start: 0, end: 4 }])
    // Final sigma, medial sigma and capital sigma are the same letter for
    // matching, in both directions.
    expect(findInText('ΟΔΟΣ', 'οδος', OPTIONS)).toEqual([{ start: 0, end: 4 }])
    expect(findInText('οδος', 'ΟΔΟΣ', OPTIONS)).toEqual([{ start: 0, end: 4 }])
    expect(findInText('οδοσ', 'ΟΔΟΣ', OPTIONS)).toEqual([{ start: 0, end: 4 }])
    expect(findInText('ς', 'Σ', OPTIONS)).toEqual([{ start: 0, end: 1 }])
    expect(findInText('Σ', 'ς', OPTIONS)).toEqual([{ start: 0, end: 1 }])
    // Whole word still reads the stored letters: 'οδος' is only a prefix
    // of 'ΟΔΟΣΑ', but the whole word inside a sentence matches.
    const whole = { matchCase: false, wholeWord: true }
    expect(findInText('ΟΔΟΣΑ', 'οδος', whole)).toEqual([])
    expect(findInText('η ΟΔΟΣ μου', 'οδος', whole)).toEqual([
      { start: 2, end: 6 },
    ])
    // Match case keeps the forms distinct.
    expect(
      findInText('ΟΔΟΣ', 'οδος', { matchCase: true, wholeWord: false }),
    ).toEqual([])
    expect(
      findInText('ΟΔΟΣ', 'ΟΔΟΣ', { matchCase: true, wholeWord: false }),
    ).toEqual([{ start: 0, end: 4 }])
  })

  it('keeps word edges honest around combining marks and astral letters', () => {
    const whole = { matchCase: false, wholeWord: true }
    // 'é' inside a longer word is not a whole-word hit — a combining mark at
    // the edge is still part of the word, stored composed or decomposed.
    expect(findInText('bést bést', 'é', whole)).toEqual([])
    expect(findInText('the é best', 'é', whole)).toEqual([{ start: 4, end: 5 }])
    expect(findInText('𝕏 b', 'b', whole)).toEqual([{ start: 3, end: 4 }])
  })

  it('finds nothing for an empty needle', () => {
    expect(findInText('text', '', OPTIONS)).toEqual([])
    expect(findInText('', 'x', OPTIONS)).toEqual([])
  })
})

describe('find in document', () => {
  it('finds case-insensitive hits across paragraphs, drafts, and inserts', () => {
    expect(ends(findInDocument(model, state({}, [], [], {}), 'hello'))).toEqual(
      [
        [
          { paragraphId: 'p1', offset: 0 },
          { paragraphId: 'p1', offset: 5 },
        ],
        [
          { paragraphId: 'p2', offset: 0 },
          { paragraphId: 'p2', offset: 5 },
        ],
      ],
    )
    expect(
      ends(
        findInDocument(
          model,
          state({ 'p1-r': 'Changed World' }, [], [], {}),
          'world',
        ),
      ),
    ).toEqual([
      [
        { paragraphId: 'p1', offset: 8 },
        { paragraphId: 'p1', offset: 13 },
      ],
    ])
    expect(
      ends(
        findInDocument(
          model,
          state(
            {},
            [
              {
                clientId: 'ins1',
                afterParagraphId: 'p1',
                text: 'Hello insert',
              },
            ],
            [],
            {},
          ),
          'insert',
        ),
      ),
    ).toEqual([
      [
        { paragraphId: 'ins1', offset: 6 },
        { paragraphId: 'ins1', offset: 12 },
      ],
    ])
    expect(
      ends(findInDocument(model, state({}, [], ['p1'], {}), 'hello')),
    ).toEqual([
      [
        { paragraphId: 'p2', offset: 0 },
        { paragraphId: 'p2', offset: 5 },
      ],
    ])
    expect(findInDocument(model, state({}, [], [], {}), '')).toEqual([])
  })

  it('finds a folded Greek hit at its real UTF-16 offsets', () => {
    const greek: DocumentModelWire = {
      ...model,
      stories: [story([paragraph('p1', 'Η ΟΔΟΣ κλείνει')])],
    }
    expect(ends(findInDocument(greek, state({}, [], [], {}), 'οδος'))).toEqual([
      [
        { paragraphId: 'p1', offset: 2 },
        { paragraphId: 'p1', offset: 6 },
      ],
    ])
  })

  it('crosses a paragraph break through a space in the query', () => {
    const hits = findInDocument(model, state({}, [], [], {}), 'world hello')
    expect(ends(hits)).toEqual([
      [
        { paragraphId: 'p1', offset: 6 },
        { paragraphId: 'p2', offset: 5 },
      ],
    ])
    // The break belongs to the hit: each covered paragraph reports its slice,
    // and the replaced range covers the break too.
    expect(hits[0]?.segments).toEqual([
      { paragraphId: 'p1', start: 6, end: 11 },
      { paragraphId: 'p2', start: 0, end: 5 },
    ])
    expect(
      findInDocument(model, state({}, [], [], {}), 'world hello', undefined, {
        matchCase: false,
        wholeWord: true,
      }),
    ).toHaveLength(1)
    expect(
      findInDocument(model, state({}, [], [], {}), 'World Hello', undefined, {
        matchCase: true,
        wholeWord: false,
      }),
    ).toHaveLength(0)
  })

  it('maps a hit covering only the break to both paragraph edges', () => {
    const hits = findInDocument(model, state({}, [], [], {}), ' ')
    expect(ends(hits)).toEqual([
      [
        { paragraphId: 'p1', offset: 5 },
        { paragraphId: 'p1', offset: 6 },
      ],
      [
        { paragraphId: 'p1', offset: 11 },
        { paragraphId: 'p2', offset: 0 },
      ],
      [
        { paragraphId: 'p2', offset: 5 },
        { paragraphId: 'p2', offset: 6 },
      ],
    ])
    expect(hits[1]?.segments).toEqual([
      { paragraphId: 'p1', start: 11, end: 11 },
      { paragraphId: 'p2', start: 0, end: 0 },
    ])
  })

  it('joins pending inserts into the same match run', () => {
    const hits = findInDocument(
      model,
      state(
        {},
        [{ clientId: 'ins1', afterParagraphId: 'p1', text: 'Inserted text' }],
        [],
        {},
      ),
      'world inserted',
    )
    expect(ends(hits)).toEqual([
      [
        { paragraphId: 'p1', offset: 6 },
        { paragraphId: 'ins1', offset: 8 },
      ],
    ])
  })

  it('never concatenates a table cell to its neighbours', () => {
    const tableXml =
      '<w:tbl><w:tr><w:tc><w:p w14:paraId="CELLOO01"><w:r><w:t>cell one</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const withTable: DocumentModelWire = {
      ...model,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            paragraph('lead', 'lead in'),
            paragraph('para-w14-CELLOO01', 'cell one'),
            paragraph('tail', 'in tail'),
          ],
          preservedXmlFragments: [tableXml],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
    }
    // The cell's own text is findable…
    expect(
      ends(findInDocument(withTable, state({}, [], [], {}), 'cell')),
    ).toEqual([
      [
        { paragraphId: 'para-w14-CELLOO01', offset: 0 },
        { paragraphId: 'para-w14-CELLOO01', offset: 4 },
      ],
    ])
    // …but a query cannot bridge the container edges into reading order.
    expect(findInDocument(withTable, state({}, [], [], {}), 'in cell')).toEqual(
      [],
    )
    expect(findInDocument(withTable, state({}, [], [], {}), 'in in')).toEqual(
      [],
    )
  })

  it('finds text stored in extraRuns for zero-run and joined paragraphs', () => {
    const zeroRunModel: DocumentModelWire = {
      ...model,
      stories: [story([{ id: 'p1', runs: [], preservedXmlFragments: [] }])],
    }
    expect(
      ends(
        findInDocument(
          zeroRunModel,
          state({}, [], [], {
            p1: [{ id: 'x1', text: 'Drafted text', preservedXmlFragments: [] }],
          }),
          'drafted',
        ),
      ),
    ).toEqual([
      [
        { paragraphId: 'p1', offset: 0 },
        { paragraphId: 'p1', offset: 7 },
      ],
    ])

    // Backspace-join moves the lower paragraph's run into the upper
    // paragraph's extraRuns; its text must be findable with the offset the
    // editor renders at.
    expect(
      ends(
        findInDocument(
          model,
          state({}, [], ['p2'], {
            p1: [{ id: 'r2', text: 'Hello again', preservedXmlFragments: [] }],
          }),
          'again',
        ),
      ),
    ).toEqual([
      [
        { paragraphId: 'p1', offset: 17 },
        { paragraphId: 'p1', offset: 22 },
      ],
    ])

    // extraRuns text also honours drafts on the extra run.
    expect(
      ends(
        findInDocument(
          model,
          state({ r2: 'anew' }, [], ['p2'], {
            p1: [{ id: 'r2', text: 'Hello again', preservedXmlFragments: [] }],
          }),
          'anew',
        ),
      ),
    ).toEqual([
      [
        { paragraphId: 'p1', offset: 11 },
        { paragraphId: 'p1', offset: 15 },
      ],
    ])
  })

  it('wraps next and previous hit indexes', () => {
    const hits = findInDocument(model, state({}, [], [], {}), 'hello')
    expect(nextFindIndex(hits, -1)).toBe(0)
    expect(nextFindIndex(hits, 0)).toBe(1)
    expect(nextFindIndex(hits, 1)).toBe(0)
    expect(previousFindIndex(hits, 0)).toBe(1)
    expect(nextFindIndex([], 0)).toBe(-1)
    expect(findMatchLabel(-1, 0)).toBe('0 found')
    expect(findMatchLabel(-1, 2)).toBe('2 found')
    expect(findMatchLabel(0, 2)).toBe('1/2')
  })

  it('clamps a stale find index to the current hit set', () => {
    expect(clampFindIndex(3, 2)).toBe(-1)
    expect(clampFindIndex(3, 5)).toBe(3)
    expect(clampFindIndex(2, 2)).toBe(-1)
    expect(clampFindIndex(-1, 0)).toBe(-1)
    expect(clampFindIndex(-1, 4)).toBe(-1)
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
      breaks: [],
      structures: [],
      trackedRejections: [],
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
      breaks: [],
      structures: [],
      trackedRejections: [],
    }
    const history = pushWorkspaceDraft([], snapshot)
    snapshot.drafts.r1 = 'mutated'
    expect(history[0]?.drafts).toEqual({ r1: 'A' })
  })
})
