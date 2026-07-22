import { describe, expect, it } from 'vitest'
import {
  NearDuplicateIndex,
  assertDocumentMatchesSpec,
  assertHardNegatives,
  contentHash,
  nearDuplicatePairs,
} from './validation'
import { buildQuotaSpecs, generationSpecIdentity } from './matrix'
import type { HardNegativeAssertion, SyntheticDocument } from './types'

const negative: HardNegativeAssertion = {
  id: 'hn:claim',
  kind: 'claim_number',
  quote: 'Claim No. FICTION/CIV',
  occurrence: 1,
  expectedCount: 1,
  mustNotOverlap: ['case_reference', 'government_id'],
}

describe('structured hard negatives', () => {
  it('rejects missing, duplicated, and incorrectly labelled neutral literals', () => {
    expect(() =>
      assertHardNegatives('no neutral literal', [], [negative]),
    ).toThrow('expected 1')
    expect(() =>
      assertHardNegatives(
        'Claim No. FICTION/CIV; Claim No. FICTION/CIV',
        [],
        [negative],
      ),
    ).toThrow('expected 1')
    expect(() =>
      assertHardNegatives(
        'Claim No. FICTION/CIV',
        [
          {
            category: 'case_reference',
            start: 0,
            end: 20,
            text: 'Claim No. FICTION/CIV',
          },
        ],
        [negative],
      ),
    ).toThrow('must not overlap')
  })
  it('uses the same validation before and after annotation repair', () => {
    expect(() =>
      assertHardNegatives(
        'Claim No. FICTION/CIV',
        [
          {
            category: 'government_id',
            start: 0,
            end: 20,
            text: 'Claim No. FICTION/CIV',
          },
        ],
        [negative],
      ),
    ).toThrow('must not overlap')
  })
})

describe('document-to-spec validation', () => {
  const spec = buildQuotaSpecs(1, 'validation')[0]!
  const values = spec.requiredCategories.map((category) => `value-${category}`)
  const text = values.join(' ')
  const spans = spec.requiredCategories.map((category, index) => {
    const value = values[index]!
    const start = text.indexOf(value)
    return { category, start, end: start + value.length, text: value }
  })
  const document = {
    id: spec.id,
    text,
    spans,
    generator: 'test',
    specCell: generationSpecIdentity(spec),
    matrixCells: spec.matrixCells,
    contentHash: contentHash(text),
    hardNegatives: spec.hardNegatives,
  }

  it('rejects overlaps, missing categories, forged coverage, and invalid hashes', () => {
    expect(() =>
      assertDocumentMatchesSpec(
        {
          ...document,
          spans: [
            ...spans,
            { ...spans[0]!, start: 1, end: 2, text: text.slice(1, 2) },
          ],
        },
        spec,
      ),
    ).toThrow(/Overlapping|Offset round-trip/)
    expect(() =>
      assertDocumentMatchesSpec({ ...document, spans: spans.slice(1) }, spec),
    ).toThrow('omitted required category')
    expect(() =>
      assertDocumentMatchesSpec({ ...document, matrixCells: [] }, spec),
    ).toThrow('invalid matrix coverage')
    expect(() =>
      assertDocumentMatchesSpec(
        { ...document, contentHash: 'a'.repeat(64) },
        spec,
      ),
    ).toThrow('invalid content hash')
  })
})

describe('incremental near-duplicate index', () => {
  const documents: SyntheticDocument[] = [
    {
      id: 'a',
      text: 'one two three four five six seven eight nine ten',
      contentHash: 'a',
      spans: [],
      generator: 'test',
      specCell: 'x',
      matrixCells: [],
    },
    {
      id: 'b',
      text: 'one two three four five six seven eight nine ten',
      contentHash: 'b',
      spans: [],
      generator: 'test',
      specCell: 'x',
      matrixCells: [],
    },
    {
      id: 'c',
      text: 'different terms which do not overlap at all today',
      contentHash: 'c',
      spans: [],
      generator: 'test',
      specCell: 'x',
      matrixCells: [],
    },
  ]
  it('matches the all-pairs reference and stores deterministic evidence', () => {
    const index = new NearDuplicateIndex(0.82)
    const incremental = []
    for (const document of documents) {
      const match = index.check(document)
      if (match) incremental.push(match)
      index.add(document)
    }
    expect(incremental).toEqual(nearDuplicatePairs(documents, 0.82))
  })
})
