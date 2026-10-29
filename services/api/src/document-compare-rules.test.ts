import { describe, expect, it } from 'bun:test'
import type {
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

describe('document comparison rules', () => {
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

  it('pairs the highest-overlap paragraph before lower-scoring candidates', () => {
    const base = [paragraph('p1', 'one two three four five')]
    const target = [
      paragraph('q1', 'one two three six seven'),
      paragraph('q2', 'one two three four eight'),
    ]

    const pairs = alignParagraphs(base, target)
    expect(
      pairs.find(({ base: before }) => before?.id === 'p1')?.target?.id,
    ).toBe('q2')
  })

  it('does not anchor a paragraph ID repeated in one version', () => {
    const base = [
      paragraph('p1', 'First text', { sourceParaId: 'duplicate' }),
      paragraph('p2', 'Second text', { sourceParaId: 'duplicate' }),
    ]
    const target = [
      paragraph('q1', 'First text', { sourceParaId: 'duplicate' }),
    ]

    expect(
      alignParagraphs(base, target).map(({ base: before, target: after }) => [
        before?.id,
        after?.id,
      ]),
    ).toEqual([
      ['p1', 'q1'],
      ['p2', undefined],
    ])
  })

  it('does not anchor a paragraph ID repeated in the target version', () => {
    const base = [paragraph('p1', 'First text', { sourceParaId: 'duplicate' })]
    const target = [
      paragraph('q1', 'First text', { sourceParaId: 'duplicate' }),
      paragraph('q2', 'Second text', { sourceParaId: 'duplicate' }),
    ]

    expect(
      alignParagraphs(base, target).map(({ base: before, target: after }) => [
        before?.id,
        after?.id,
      ]),
    ).toEqual([
      ['p1', 'q1'],
      [undefined, 'q2'],
    ])
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
