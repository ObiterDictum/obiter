import { describe, expect, it } from 'bun:test'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT,
  documentComparisonEntrySchema,
} from '@obiter/contracts'
import type {
  DocumentComparisonEntry,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import { compareDocumentModels } from './document-compare'

/**
 * `compareDocumentModels` pairs paragraphs by durable `w14:paraId` identity
 * (or identical text when a paragraph carries none) and order-preserves the
 * pairs. The tests here pin the alignment contract: an insertion in the
 * middle must not cascade into "every following paragraph changed", and a
 * move must report as remove+add rather than fabricate modified pairs.
 */

function paragraph(
  id: string,
  text: string,
  options: {
    sourceParaId?: string
    styleId?: string
    runXml?: string
    paragraphXml?: string
  } = {},
): DocumentParagraphWire {
  return {
    id,
    sourceParaId: options.sourceParaId,
    styleId: options.styleId,
    runs: [
      {
        id: `${id}-r1`,
        text,
        styleId: options.styleId,
        preservedXmlFragments:
          options.runXml === undefined ? [] : [options.runXml],
      },
    ],
    preservedXmlFragments:
      options.paragraphXml === undefined ? [] : [options.paragraphXml],
  }
}

function story(
  paragraphs: DocumentParagraphWire[],
  overrides: Partial<DocumentStoryWire> = {},
): DocumentStoryWire {
  return {
    partName: 'word/document.xml',
    kind: 'document',
    paragraphs,
    preservedXmlFragments: [],
    ...overrides,
  }
}

function model(
  paragraphs: DocumentParagraphWire[],
  overrides: Partial<DocumentModelWire> = {},
): DocumentModelWire {
  return {
    version: 1,
    stories: [story(paragraphs)],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    ...overrides,
  }
}

describe('compareDocumentModels', () => {
  it('reports no entries for identical models', () => {
    const base = model([
      paragraph('p1', 'The quick brown fox.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Jumps over the lazy dog.', { sourceParaId: 'aa02' }),
    ])
    const result = compareDocumentModels(
      base,
      model([...base.stories[0].paragraphs]),
    )
    expect(result.entries).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('reports a middle insertion without touching its neighbours', () => {
    const base = model([
      paragraph('p1', 'First.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Last.', { sourceParaId: 'aa02' }),
    ])
    const target = model([
      paragraph('p1', 'First.', { sourceParaId: 'aa01' }),
      paragraph('p9', 'Inserted middle.', { sourceParaId: 'aa09' }),
      paragraph('p2', 'Last.', { sourceParaId: 'aa02' }),
    ])
    // A positional zip would report p2 modified and a new tail — the real
    // alignment reports exactly one added paragraph.
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'p9',
        text: 'Inserted middle.',
        textTruncated: false,
      },
    ])
  })

  it('reports a removal and a word-level modification', () => {
    const base = model([
      paragraph('p1', 'The claim fails.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Drop me.', { sourceParaId: 'aa02' }),
    ])
    const target = model([
      paragraph('p1', 'The claim succeeds.', { sourceParaId: 'aa01' }),
    ])
    const entries = compareDocumentModels(base, target).entries
    expect(entries).toHaveLength(2)
    const modified = entries.find((entry) => entry.type === 'modified')
    const removed = entries.find((entry) => entry.type === 'removed')
    expect(modified).toMatchObject({
      paragraphId: 'p1',
      segments: [
        { kind: 'same', text: 'The claim ' },
        { kind: 'removed', text: 'fails.' },
        { kind: 'added', text: 'succeeds.' },
      ],
    })
    expect(removed).toMatchObject({ paragraphId: 'p2', text: 'Drop me.' })
  })

  it('reports a reorder as remove plus add, not fabricated modifications', () => {
    const base = model([
      paragraph('p1', 'Alpha.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Beta.', { sourceParaId: 'aa02' }),
      paragraph('p3', 'Gamma.', { sourceParaId: 'aa03' }),
    ])
    // Gamma moves from last to first.
    const target = model([
      paragraph('p3', 'Gamma.', { sourceParaId: 'aa03' }),
      paragraph('p1', 'Alpha.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Beta.', { sourceParaId: 'aa02' }),
    ])
    const entries = compareDocumentModels(base, target).entries
    const kinds = entries.map((entry) => entry.type).sort()
    expect(kinds).toEqual(['added', 'removed'])
    expect(entries.find((entry) => entry.type === 'removed')).toMatchObject({
      paragraphId: 'p3',
    })
    expect(entries.find((entry) => entry.type === 'added')).toMatchObject({
      paragraphId: 'p3',
    })
  })

  it('reports a reorder without durable ids as remove plus add', () => {
    // Neither side carries `w14:paraId`; this is the pre-canonicalisation
    // corpus the fallback tiers exist for. Identical text pairs inverted
    // across the texts (Alpha at (0,1), Beta at (1,0)); the loser of the
    // crossing must demote to unmatched and report remove+add. Emitting
    // the base-sorted union instead reported two bare additions, and the
    // moved text's removal was suppressed entirely.
    const base = model([paragraph('p1', 'Alpha.'), paragraph('p2', 'Beta.')])
    const target = model([paragraph('q2', 'Beta.'), paragraph('q1', 'Alpha.')])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'removed',
        storyPartName: 'word/document.xml',
        paragraphId: 'p1',
        text: 'Alpha.',
        textTruncated: false,
      },
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'q1',
        text: 'Alpha.',
        textTruncated: false,
      },
    ])
  })

  it('reports a three-paragraph rotation without ids as remove plus add', () => {
    const base = model([
      paragraph('p1', 'One.'),
      paragraph('p2', 'Two.'),
      paragraph('p3', 'Three.'),
    ])
    const target = model([
      paragraph('q3', 'Three.'),
      paragraph('q1', 'One.'),
      paragraph('q2', 'Two.'),
    ])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'q3',
        text: 'Three.',
        textTruncated: false,
      },
      {
        type: 'removed',
        storyPartName: 'word/document.xml',
        paragraphId: 'p3',
        text: 'Three.',
        textTruncated: false,
      },
    ])
  })

  it('keeps an in-gap reorder between anchors honest', () => {
    // Anchored ends, an unanchored middle pair swapped: the identical-text
    // pass pairs the middle inverted inside one gap. The alignment must
    // still report the moved paragraph's removal; before monotonic
    // enforcement this emitted a single bare 'added' and nothing else.
    const base = model([
      paragraph('h', 'Head.', { sourceParaId: 'hh' }),
      paragraph('p1', 'Middle one.'),
      paragraph('p2', 'Middle two.'),
      paragraph('t', 'Tail.', { sourceParaId: 'tt' }),
    ])
    const target = model([
      paragraph('h', 'Head.', { sourceParaId: 'hh' }),
      paragraph('q2', 'Middle two.'),
      paragraph('q1', 'Middle one.'),
      paragraph('t', 'Tail.', { sourceParaId: 'tt' }),
    ])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'removed',
        storyPartName: 'word/document.xml',
        paragraphId: 'p1',
        text: 'Middle one.',
        textTruncated: false,
      },
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'q1',
        text: 'Middle one.',
        textTruncated: false,
      },
    ])
  })

  it('does not claim a reordered edited paragraph as both added and modified', () => {
    // Overlap pairs are chosen by score, not position, so an edited swap
    // pairs inverted the same way identical text does. One side of the
    // crossing wins and reports modified; the loser is an honest
    // remove+add. Previously every target index below a pair's targetIndex
    // emitted 'added' even when it was itself paired, so a paragraph
    // counted twice, once added and once modified.
    const base = model([
      paragraph('p1', 'The claimant seeks damages for breach.'),
      paragraph('p2', 'The defendant denies all liability entirely.'),
    ])
    const target = model([
      paragraph('q2', 'The defendant denies all liability absolutely.'),
      paragraph('q1', 'The claimant seeks damages for repudiation.'),
    ])
    const entries = compareDocumentModels(base, target).entries
    expect(entries.map((entry) => entry.type)).toEqual([
      'removed',
      'modified',
      'added',
    ])
    expect(entries[0]).toMatchObject({ paragraphId: 'p1' })
    expect(entries[2]).toMatchObject({ paragraphId: 'q1' })
    const modified = entries[1]
    expect(modified).toMatchObject({ paragraphId: 'q2' })
    if (modified?.type !== 'modified') {
      throw new Error('Expected a modified entry.')
    }
    expectReconstructed(
      modified,
      'The defendant denies all liability entirely.',
      'The defendant denies all liability absolutely.',
    )
  })

  it('demotes an inverted duplicate-text pair instead of hiding the move', () => {
    // Occurrence pairing is monotonic within one repeated text but inverts
    // across texts: 'Same.' pairs (0,0) and (2,1), 'Mid.' pairs (1,2). The
    // dropped side reports as remove+add, not a lone bare addition.
    const base = model([
      paragraph('p1', 'Same.'),
      paragraph('p2', 'Mid.'),
      paragraph('p3', 'Same.'),
    ])
    const target = model([
      paragraph('q1', 'Same.'),
      paragraph('q2', 'Same.'),
      paragraph('q3', 'Mid.'),
    ])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'removed',
        storyPartName: 'word/document.xml',
        paragraphId: 'p2',
        text: 'Mid.',
        textTruncated: false,
      },
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'q3',
        text: 'Mid.',
        textTruncated: false,
      },
    ])
  })

  it('reports a formatting-only change as formatted, not modified', () => {
    const base = model([
      paragraph('p1', 'Same words.', {
        sourceParaId: 'aa01',
        runXml: '<w:rPr><w:i/></w:rPr>',
      }),
    ])
    const target = model([
      paragraph('p1', 'Same words.', {
        sourceParaId: 'aa01',
        runXml: '<w:rPr><w:b/></w:rPr>',
      }),
    ])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'formatted',
        storyPartName: 'word/document.xml',
        paragraphId: 'p1',
        text: 'Same words.',
        textTruncated: false,
      },
    ])
  })

  it('does not manufacture a format entry for a pure run split', () => {
    const base = model([
      paragraph('p1', 'Same words.', { sourceParaId: 'aa01' }),
    ])
    const split = paragraph('p1', '', { sourceParaId: 'aa01' })
    split.runs = [
      { id: 'p1-a', text: 'Same ', preservedXmlFragments: [] },
      { id: 'p1-b', text: 'words.', preservedXmlFragments: [] },
    ]
    const target = model([split])
    expect(compareDocumentModels(base, target).entries).toEqual([])
  })

  it('pairs paragraphs without durable ids on identical text only', () => {
    const base = model([
      paragraph('p1', 'Heading'),
      paragraph('p2', 'Body text.'),
    ])
    // The heading keeps its text; a brand-new paragraph carries no durable
    // id and no matching text, so it is an add — not a "modified heading".
    const target = model([
      paragraph('p9', 'Different text entirely.'),
      paragraph('p1', 'Heading'),
      paragraph('p2', 'Body text.'),
    ])
    expect(compareDocumentModels(base, target).entries).toEqual([
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'p9',
        text: 'Different text entirely.',
        textTruncated: false,
      },
    ])
  })

  it('still aligns an edit across the w14 canonicalisation boundary', () => {
    // The uploaded v1 predates `canonicaliseParagraphIdentities`, so its
    // paragraphs carry no durable ids while v2's all do. Id keys can never
    // match here; identical text pairs the unchanged paragraphs and word
    // overlap pairs the edited one — otherwise the whole document would
    // report as remove+add.
    const base = model([
      paragraph('p1', 'IN THE HIGH COURT OF JUSTICE'),
      paragraph('p2', "KING'S BENCH DIVISION"),
      paragraph('p3', ''),
    ])
    const target = model([
      paragraph('q1', 'E10MARK IN THE HIGH COURT OF JUSTICE', {
        sourceParaId: '00000001',
      }),
      paragraph('q2', "KING'S BENCH DIVISION", { sourceParaId: '00000002' }),
      paragraph('q3', '', { sourceParaId: '00000003' }),
    ])
    const entries = compareDocumentModels(base, target).entries
    expect(entries).toEqual([
      {
        type: 'modified',
        storyPartName: 'word/document.xml',
        paragraphId: 'q1',
        segments: [
          { kind: 'added', text: 'E10MARK ' },
          { kind: 'same', text: 'IN THE HIGH COURT OF JUSTICE' },
        ],
      },
    ])
  })

  it('does not similarity-pair unrelated text below the overlap bar', () => {
    // Only 'The claim' survives — below the common-word and overlap minimums,
    // so this is an honest delete+insert, not a fabricated 'modified'.
    const base = model([paragraph('p1', 'The claim fails.')])
    const target = model([
      paragraph('q1', 'The claim succeeds beyond doubt entirely.'),
    ])
    const kinds = compareDocumentModels(base, target).entries.map(
      (entry) => entry.type,
    )
    expect(kinds.sort()).toEqual(['added', 'removed'])
  })

  it('reports story structure and package area changes', () => {
    const base = model([paragraph('p1', 'Text.', { sourceParaId: 'aa01' })], {
      styles: [{ styleId: 'Normal', sourceFragment: '<w:style a/>' }],
    })
    const target = model([paragraph('p1', 'Text.', { sourceParaId: 'aa01' })], {
      styles: [{ styleId: 'Normal', sourceFragment: '<w:style b/>' }],
    })
    target.stories[0] = story(target.stories[0].paragraphs, {
      preservedXmlFragments: ['<w:sectPr new/>'],
    })
    const kinds = compareDocumentModels(base, target).entries.map(
      (entry) => entry.type,
    )
    expect(kinds.sort()).toEqual(['package', 'story'])
  })

  it('keeps entries ordered and bounded past the entry cap', () => {
    const base = model([paragraph('p0', 'Anchor.', { sourceParaId: 'aa00' })])
    const target = model([
      paragraph('p0', 'Anchor.', { sourceParaId: 'aa00' }),
      ...Array.from(
        { length: DOCUMENT_COMPARISON_ENTRY_MAX_COUNT + 50 },
        (_, index) => paragraph(`n${index}`, `New ${index}.`),
      ),
    ])
    const result = compareDocumentModels(base, target)
    expect(result.entries).toHaveLength(DOCUMENT_COMPARISON_ENTRY_MAX_COUNT)
    expect(result.truncated).toBe(true)
    expect(result.entries[0]).toMatchObject({ type: 'added' })
  })

  it('flags truncation when the overflowing difference is a modified pair', () => {
    // Past the cap the word diff is skipped work, but the pair still counts:
    // a text difference after a full entry list must set entriesTruncated
    // even though no entry was ever built for it.
    const filler = Array.from(
      { length: DOCUMENT_COMPARISON_ENTRY_MAX_COUNT },
      (_, index) => paragraph(`n${index}`, `New ${index}.`),
    )
    const shared = [
      paragraph('s1', 'Same text.', { sourceParaId: 's1' }),
      paragraph('s2', 'Old wording.', { sourceParaId: 's2' }),
    ]
    const result = compareDocumentModels(
      model(shared),
      model([
        ...filler,
        paragraph('s1', 'Same text.', { sourceParaId: 's1' }),
        paragraph('s2', 'New wording.', { sourceParaId: 's2' }),
      ]),
    )
    expect(result.entries).toHaveLength(DOCUMENT_COMPARISON_ENTRY_MAX_COUNT)
    expect(result.entries.every((entry) => entry.type === 'added')).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('does not flag truncation for identical pairs beyond the cap', () => {
    // The early exit must still tell a real difference from an unchanged
    // pair: an exact-cap result with an identical tail is complete, not
    // truncated.
    const filler = Array.from(
      { length: DOCUMENT_COMPARISON_ENTRY_MAX_COUNT },
      (_, index) => paragraph(`n${index}`, `New ${index}.`),
    )
    const shared = [
      paragraph('s1', 'Same text.', { sourceParaId: 's1' }),
      paragraph('s2', 'Also same.', { sourceParaId: 's2' }),
    ]
    const result = compareDocumentModels(
      model(shared),
      model([...filler, ...shared]),
    )
    expect(result.entries).toHaveLength(DOCUMENT_COMPARISON_ENTRY_MAX_COUNT)
    expect(result.truncated).toBe(false)
  })

  it('pairs duplicate identical paragraphs by occurrence, not uniqueness', () => {
    // Real documents are full of empty spacer paragraphs. Requiring a text to
    // be gap-unique left every one of them unmatched, so even a version
    // compared to itself reported page after page of remove+add noise.
    const paragraphs = [
      paragraph('p1', 'Heading', { sourceParaId: 'a1' }),
      paragraph('p2', ''),
      paragraph('p3', 'Body.', { sourceParaId: 'a2' }),
      paragraph('p4', ''),
      paragraph('p5', ''),
    ]
    const result = compareDocumentModels(model(paragraphs), model(paragraphs))
    expect(result.entries).toEqual([])
    // And a genuine extra spacer still reports as exactly one added entry.
    const withExtra = model([...paragraphs, paragraph('p6', '')])
    const diff = compareDocumentModels(model(paragraphs), withExtra)
    expect(diff.entries).toEqual([
      {
        type: 'added',
        storyPartName: 'word/document.xml',
        paragraphId: 'p6',
        text: '',
        textTruncated: false,
      },
    ])
  })

  it('handles unicode and empty paragraphs without collapsing', () => {
    const base = model([
      paragraph('p1', 'Café — naïve.', { sourceParaId: 'x' }),
    ])
    const target = model([
      paragraph('p1', 'Café — naïve.', { sourceParaId: 'x' }),
      paragraph('p2', '', { sourceParaId: 'y' }),
      paragraph('p3', '日本語の段落。', { sourceParaId: 'z' }),
    ])
    const entries = compareDocumentModels(base, target).entries
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: 'added', text: '' })
    expect(entries[1]).toMatchObject({ type: 'added', text: '日本語の段落。' })
  })

  it('is deterministic across runs', () => {
    const base = model([
      paragraph('p1', 'A.', { sourceParaId: 'a' }),
      paragraph('p2', 'B.', { sourceParaId: 'b' }),
      paragraph('p3', 'C.', { sourceParaId: 'c' }),
    ])
    const target = model([
      paragraph('p3', 'C.', { sourceParaId: 'c' }),
      paragraph('p4', 'D.', { sourceParaId: 'd' }),
      paragraph('p1', 'A. changed', { sourceParaId: 'a' }),
    ])
    const first = compareDocumentModels(base, target)
    const second = compareDocumentModels(base, target)
    expect(second).toEqual(first)
  })

  /**
   * Independent oracle for a `modified` entry: rejoining every segment that
   * is not an insertion must rebuild the base text verbatim, and every
   * segment that is not a removal must rebuild the target — whether the diff
   * was word-level or the bounded coarse fallback.
   */
  function expectReconstructed(
    entry: DocumentComparisonEntry,
    baseText: string,
    targetText: string,
  ) {
    if (entry.type !== 'modified') throw new Error('Expected a modified entry.')
    expect(
      entry.segments
        .filter((segment) => segment.kind !== 'added')
        .map((segment) => segment.text)
        .join(''),
    ).toBe(baseText)
    expect(
      entry.segments
        .filter((segment) => segment.kind !== 'removed')
        .map((segment) => segment.text)
        .join(''),
    ).toBe(targetText)
  }

  it('collapses a dense rewrite inside the segment bound', () => {
    // Two differing words between each shared word stay under the word-diff
    // token limit (479 tokens), so the LCS path runs — and fragments into 480
    // segments, past the contract bound. The producer must fall back to the
    // coarse form rather than emit a response the schema rejects.
    const baseWords: string[] = []
    const targetWords: string[] = []
    for (let index = 0; index < 80; index += 1) {
      baseWords.push(`old${index}a`, `old${index}b`, `keep${index}`)
      targetWords.push(`new${index}a`, `new${index}b`, `keep${index}`)
    }
    const baseText = baseWords.join(' ')
    const targetText = targetWords.join(' ')
    const [entry] = compareDocumentModels(
      model([paragraph('p1', baseText, { sourceParaId: 'a' })]),
      model([paragraph('p1', targetText, { sourceParaId: 'a' })]),
    ).entries
    expect(entry?.type).toBe('modified')
    if (entry?.type !== 'modified') return
    expect(entry.segments.length).toBeLessThanOrEqual(
      DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT,
    )
    expect(documentComparisonEntrySchema.safeParse(entry).success).toBe(true)
    // The fallback is lossless: every real change still reports, and the
    // segments carry the full before and after text.
    expectReconstructed(entry, baseText, targetText)
    expect(entry.segments.some((segment) => segment.kind === 'removed')).toBe(
      true,
    )
    expect(entry.segments.some((segment) => segment.kind === 'added')).toBe(
      true,
    )
  })

  it('stays inside the contract bounds under a seeded rewrite fuzz', () => {
    // Deterministic LCG: the same corpus every run, so a failure reproduces
    // exactly. Paragraphs are ~200-280 words from a shared 40-word
    // vocabulary — coincidental matches fragment the token-level diff far
    // past the segment bound, which is how the original defect escaped.
    let state = 0x9e3779b9
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
    const vocabulary = Array.from({ length: 40 }, (_, i) => `w${i}`)
    const words = (count: number) =>
      Array.from(
        { length: count },
        () => vocabulary[Math.floor(next() * vocabulary.length)],
      ).join(' ')
    let modifiedCount = 0
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const baseText = words(200 + Math.floor(next() * 80))
      const targetText = words(200 + Math.floor(next() * 80))
      const result = compareDocumentModels(
        model([paragraph('p1', baseText)]),
        model([paragraph('p1', targetText)]),
      )
      for (const entry of result.entries) {
        expect(documentComparisonEntrySchema.safeParse(entry).success).toBe(
          true,
        )
        if (entry.type === 'modified') {
          modifiedCount += 1
          expect(entry.segments.length).toBeLessThanOrEqual(
            DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT,
          )
          expectReconstructed(entry, baseText, targetText)
        }
      }
    }
    // The corpus is pointless if no paragraph ever pairs as modified.
    expect(modifiedCount).toBeGreaterThan(0)
  })
})
