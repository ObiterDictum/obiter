import { describe, expect, it } from 'bun:test'
import { DOCUMENT_COMPARISON_ENTRY_MAX_COUNT } from '@obiter/contracts'
import type {
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
})
