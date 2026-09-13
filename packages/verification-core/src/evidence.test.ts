import { describe, expect, it } from 'vitest'
import {
  createEvidenceReferenceId,
  evidenceReferenceSchema,
  type EvidenceReference,
} from './index'

const judgmentReference = {
  sourceType: 'judgment',
  sourceId: 'uksc-2099-1',
  ordinal: 12,
  paragraphNumber: 9,
} satisfies EvidenceReference

const legislationReference = {
  sourceType: 'legislation_provision',
  sourceId: 'ukpga/2010/15',
  labelPath: 'section/40',
} satisfies EvidenceReference

describe('Evidence references', () => {
  it('parses a judgment paragraph reference', () => {
    expect(evidenceReferenceSchema.parse(judgmentReference)).toEqual(
      judgmentReference,
    )
  })

  it('parses a legislation provision reference', () => {
    expect(evidenceReferenceSchema.parse(legislationReference)).toEqual(
      legislationReference,
    )
  })

  it('rejects a reference missing its locator or carrying the wrong one', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        sourceId: 'uksc-2099-1',
        paragraphNumber: 9,
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        sourceId: 'uksc-2099-1',
        ordinal: 12,
        paragraphNumber: 9,
        labelPath: 'section/40',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: '',
        labelPath: 'section/40',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: 'ukpga/2010/15',
        labelPath: 'section/40',
        ordinal: 12,
      }),
    ).toThrow()
  })

  it('keeps judgment and legislation locators from crossing', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: 'ukpga/2010/15',
        labelPath: 'section/40',
        paragraphNumber: null,
      }),
    ).toThrow()
  })

  it('rejects a source id that could collide with the id delimiter', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        ...judgmentReference,
        sourceId: 'a:judgment_paragraph:1',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: 'a:legislation_provision:x',
        labelPath: 'y',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: 'ukpga/2010/15',
        labelPath: 'section:x',
      }),
    ).toThrow()
  })

  it('accepts only canonical legislation identities as evidence sources', () => {
    for (const sourceId of ['garbage', 'ukpga/2010', 'ukpga//15']) {
      expect(() =>
        evidenceReferenceSchema.parse({
          sourceType: 'legislation_provision',
          sourceId,
          labelPath: 'section/40',
        }),
      ).toThrow()
    }
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        sourceId: 'ukpga/2010/15',
        labelPath: '../../etc/passwd',
      }),
    ).toThrow()
  })
})

describe('Evidence reference identity', () => {
  it('is stable across identical references', () => {
    expect(createEvidenceReferenceId(judgmentReference)).toBe(
      createEvidenceReferenceId({ ...judgmentReference }),
    )
    expect(createEvidenceReferenceId(legislationReference)).toBe(
      createEvidenceReferenceId({ ...legislationReference }),
    )
  })

  it('distinguishes the paragraph, provision and source it points at', () => {
    expect(createEvidenceReferenceId(judgmentReference)).not.toBe(
      createEvidenceReferenceId({ ...judgmentReference, ordinal: 13 }),
    )
    expect(createEvidenceReferenceId(judgmentReference)).not.toBe(
      createEvidenceReferenceId(legislationReference),
    )
    expect(createEvidenceReferenceId(legislationReference)).not.toBe(
      createEvidenceReferenceId({
        ...legislationReference,
        labelPath: 'section/41',
      }),
    )
  })

  it('matches the evidence id format search anchors judgment paragraphs with', () => {
    expect(createEvidenceReferenceId(judgmentReference)).toBe(
      'uksc-2099-1:judgment_paragraph:12',
    )
  })

  it('never collapses two schema-valid references into one id', () => {
    const references: EvidenceReference[] = [
      judgmentReference,
      { ...judgmentReference, sourceId: 'uksc-2099-2' },
      { ...judgmentReference, ordinal: 1, paragraphNumber: null },
      legislationReference,
      { ...legislationReference, labelPath: 'section/4' },
      {
        sourceType: 'legislation_provision',
        sourceId: 'ukpga/1998/42',
        labelPath: 'section/40',
      },
    ]
    const ids = references.map((reference) => {
      expect(evidenceReferenceSchema.safeParse(reference).success).toBe(true)
      return createEvidenceReferenceId(reference)
    })

    expect(new Set(ids).size).toBe(references.length)
  })

  it('is built from ids and offsets only', () => {
    const id = createEvidenceReferenceId(judgmentReference)
    expect(id).not.toContain('claimant')
    expect(id).not.toContain('paragraph 9')
    expect(JSON.parse(JSON.stringify(judgmentReference))).toEqual(
      judgmentReference,
    )
  })
})
