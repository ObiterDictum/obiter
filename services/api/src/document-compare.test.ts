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
import { alignParagraphs } from './document-compare-align'
import { wordDiff } from './document-compare-word-diff'

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
    fields: [],
    unanchoredFieldParagraphIds: [],
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
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
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

  it('reads a replacement recorded as a tracked delete and insert in place', () => {
    const base = model([
      paragraph('p1', 'Pay not less than 60,000 units.', {
        sourceParaId: 'aa01',
      }),
    ])
    const target = model(
      [
        {
          id: 'p1',
          sourceParaId: 'aa01',
          runs: [
            {
              id: 'p1-r1',
              text: 'Pay not less than ',
              preservedXmlFragments: [],
            },
            { id: 'p1-r2', text: ' units.', preservedXmlFragments: [] },
          ],
          preservedXmlFragments: [],
        },
      ],
      {
        changes: [
          {
            id: 'c1',
            kind: 'delete',
            elementName: 'del',
            storyPartName: 'word/document.xml',
            paragraphId: 'p1',
            inlinePosition: {
              beforeRunId: 'p1-r2',
              segments: [{ text: '60,000', deleted: true }],
            },
            text: '60,000',
          },
          {
            id: 'c2',
            kind: 'insert',
            elementName: 'ins',
            storyPartName: 'word/document.xml',
            paragraphId: 'p1',
            inlinePosition: {
              beforeRunId: 'p1-r2',
              segments: [{ text: '45,000', deleted: false }],
            },
            text: '45,000',
          },
        ],
      },
    )
    const entries = compareDocumentModels(base, target).entries
    expect(entries[0]).toEqual({
      type: 'modified',
      storyPartName: 'word/document.xml',
      paragraphId: 'p1',
      segments: [
        { kind: 'same', text: 'Pay not less than ' },
        { kind: 'removed', text: '60,000' },
        { kind: 'added', text: '45,000' },
        { kind: 'same', text: ' units.' },
      ],
    })
    expect(entries[1]).toEqual({ type: 'package', area: 'revisions' })
  })

  it('reports a reorder as remove plus add, not fabricated modifications', () => {
    const base = model([
      paragraph('p1', 'Alpha.', { sourceParaId: 'aa01' }),
      paragraph('p2', 'Beta.', { sourceParaId: 'aa02' }),
      paragraph('p3', 'Gamma.', { sourceParaId: 'aa03' }),
    ])
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
    const base = model([paragraph('p1', 'The claim fails.')])
    const target = model([
      paragraph('q1', 'The claim succeeds beyond doubt entirely.'),
    ])
    const kinds = compareDocumentModels(base, target).entries.map(
      (entry) => entry.type,
    )
    expect(kinds.sort()).toEqual(['added', 'removed'])
  })

  it('excludes whitespace from paragraph similarity scoring', () => {
    const base = model([paragraph('p1', 'one two three four five')])
    const target = model([paragraph('q1', 'one  two  three  six  seven')])

    expect(
      compareDocumentModels(base, target).entries.map((entry) => entry.type),
    ).toEqual(['modified'])
  })

  it('pairs paragraphs at 60 percent word overlap', () => {
    const base = model([paragraph('p1', 'one two three four five')])
    const target = model([paragraph('q1', 'one two three six seven')])

    expect(
      compareDocumentModels(base, target).entries.map((entry) => entry.type),
    ).toEqual(['modified'])
  })

  it('does not pair paragraphs on fewer than three common words', () => {
    const base = model([paragraph('p1', 'one two')])
    const target = model([paragraph('q1', 'one two three')])

    expect(
      compareDocumentModels(base, target).entries.map((entry) => entry.type),
    ).toEqual(['removed', 'added'])
  })

  it('does not similarity-pair paragraphs across an oversized unmatched gap', () => {
    const base = model(
      Array.from({ length: 65 }, (_, index) =>
        paragraph(`p${index}`, `one two three base${index}`),
      ),
    )
    const target = model(
      Array.from({ length: 65 }, (_, index) =>
        paragraph(`q${index}`, `one two three target${index}`),
      ),
    )

    const entries = compareDocumentModels(base, target).entries
    expect(entries.filter((entry) => entry.type === 'modified')).toHaveLength(0)
    expect(entries.filter((entry) => entry.type === 'removed')).toHaveLength(65)
    expect(entries.filter((entry) => entry.type === 'added')).toHaveLength(65)
  })

  it('breaks equal similarity scores by base order and then target order', () => {
    const base = [
      paragraph('p1', 'one two three alpha'),
      paragraph('p2', 'one two three beta'),
    ]
    const target = [
      paragraph('q1', 'one two three gamma'),
      paragraph('q2', 'one two three delta'),
    ]

    expect(
      alignParagraphs(base, target).map(({ base: before, target: after }) => [
        before?.id,
        after?.id,
      ]),
    ).toEqual([
      ['p1', 'q1'],
      ['p2', 'q2'],
    ])
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

  it('does not report a package change when styles are reordered', () => {
    const styles = [
      { styleId: 'First', sourceFragment: '<w:style first/>' },
      { styleId: 'Second', sourceFragment: '<w:style second/>' },
    ]
    const base = model([], { styles })
    const target = model([], { styles: [...styles].reverse() })

    expect(compareDocumentModels(base, target).entries).toEqual([])
  })

  it('reports a package change when style multiplicities differ', () => {
    const first = { styleId: 'First', sourceFragment: '<w:style first/>' }
    const second = { styleId: 'Second', sourceFragment: '<w:style second/>' }
    const base = model([], { styles: [first, first, second] })
    const target = model([], { styles: [first, second, second] })

    expect(compareDocumentModels(base, target).entries).toEqual([
      { type: 'package', area: 'styles' },
    ])
  })

  it('reports a one-sided story part its paragraphs cannot', () => {
    const body = [paragraph('p1', 'Body.', { sourceParaId: 'a' })]
    const header = story([], {
      partName: 'word/header1.xml',
      kind: 'header',
      preservedXmlFragments: ['<w:tbl/>'],
    })
    expect(compareDocumentModels(model(body), model(body)).entries).toEqual([])
    const added = compareDocumentModels(model(body), {
      ...model(body),
      stories: [story(body), header],
    })
    expect(added.entries).toEqual([
      { type: 'story', storyPartName: 'word/header1.xml' },
    ])
    expect(added.truncated).toBe(false)
    const removed = compareDocumentModels(
      { ...model(body), stories: [story(body), header] },
      model(body),
    )
    expect(removed.entries).toEqual([
      { type: 'story', storyPartName: 'word/header1.xml' },
    ])
  })

  it('does not double-report a one-sided story part that has paragraphs', () => {
    const body = [paragraph('p1', 'Body.', { sourceParaId: 'a' })]
    const target = model(body)
    target.stories.push(
      story([paragraph('h1', 'Head note.')], {
        partName: 'word/header1.xml',
        kind: 'header',
      }),
    )
    expect(compareDocumentModels(model(body), target).entries).toEqual([
      {
        type: 'added',
        storyPartName: 'word/header1.xml',
        paragraphId: 'h1',
        text: 'Head note.',
        textTruncated: false,
      },
    ])
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
    const paragraphs = [
      paragraph('p1', 'Heading', { sourceParaId: 'a1' }),
      paragraph('p2', ''),
      paragraph('p3', 'Body.', { sourceParaId: 'a2' }),
      paragraph('p4', ''),
      paragraph('p5', ''),
    ]
    const result = compareDocumentModels(model(paragraphs), model(paragraphs))
    expect(result.entries).toEqual([])
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
    expectReconstructed(entry, baseText, targetText)
    expect(entry.segments.some((segment) => segment.kind === 'removed')).toBe(
      true,
    )
    expect(entry.segments.some((segment) => segment.kind === 'added')).toBe(
      true,
    )
  })

  it('stays inside the contract bounds under a seeded rewrite fuzz', () => {
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
    expect(modifiedCount).toBeGreaterThan(0)
  })
})

describe('word diff', () => {
  it('keeps the common edges while collapsing an oversized changed middle', () => {
    const baseMiddle = `${'old '.repeat(260)}shared ${'before '.repeat(260)}`
    const targetMiddle = `${'new  '.repeat(260)}shared  ${'after  '.repeat(260)}`

    expect(
      wordDiff(`start ${baseMiddle}end`, `start ${targetMiddle}end`),
    ).toEqual([
      { kind: 'same', text: 'start ' },
      { kind: 'removed', text: baseMiddle },
      { kind: 'added', text: targetMiddle },
      { kind: 'same', text: 'end' },
    ])
  })
})
