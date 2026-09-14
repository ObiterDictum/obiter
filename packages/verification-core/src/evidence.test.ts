import { describe, expect, it } from 'vitest'
import {
  createEvidenceReferenceId,
  evidenceReferenceSchema,
  isDocumentEvidenceReference,
  isFragmentEvidenceReference,
  type EvidenceReference,
} from './index'

const judgmentReference = {
  sourceType: 'judgment',
  granularity: 'fragment',
  sourceId: 'uksc-2099-1',
  ordinal: 12,
  paragraphNumber: 9,
} satisfies EvidenceReference

const judgmentDocumentReference = {
  sourceType: 'judgment',
  granularity: 'document',
  sourceId: 'uksc-2099-1',
} satisfies EvidenceReference

const legislationReference = {
  sourceType: 'legislation_provision',
  granularity: 'fragment',
  sourceId: 'ukpga/2010/15',
  labelPath: 'section/40',
} satisfies EvidenceReference

const legislationDocumentReference = {
  sourceType: 'legislation_document',
  granularity: 'document',
  sourceId: 'ukpga/2010/15',
} satisfies EvidenceReference

describe('Evidence references', () => {
  it('parses a judgment paragraph reference', () => {
    expect(evidenceReferenceSchema.parse(judgmentReference)).toEqual(
      judgmentReference,
    )
  })

  it('parses the document-level references', () => {
    expect(evidenceReferenceSchema.parse(judgmentDocumentReference)).toEqual(
      judgmentDocumentReference,
    )
    expect(evidenceReferenceSchema.parse(legislationDocumentReference)).toEqual(
      legislationDocumentReference,
    )
  })

  it('parses a legislation provision reference', () => {
    expect(evidenceReferenceSchema.parse(legislationReference)).toEqual(
      legislationReference,
    )
  })

  it('classifies document and fragment references', () => {
    expect(isDocumentEvidenceReference(judgmentDocumentReference)).toBe(true)
    expect(isDocumentEvidenceReference(legislationDocumentReference)).toBe(true)
    expect(isFragmentEvidenceReference(judgmentReference)).toBe(true)
    expect(isFragmentEvidenceReference(legislationReference)).toBe(true)
    expect(isDocumentEvidenceReference(judgmentReference)).toBe(false)
    expect(isFragmentEvidenceReference(legislationDocumentReference)).toBe(
      false,
    )
  })

  it('rejects a reference missing its locator or carrying the wrong one', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'uksc-2099-1',
        paragraphNumber: 9,
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'uksc-2099-1',
        ordinal: 12,
        paragraphNumber: 9,
        labelPath: 'section/40',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: '',
        labelPath: 'section/40',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2010/15',
        labelPath: 'section/40',
        ordinal: 12,
      }),
    ).toThrow()
  })

  it('rejects a document reference that carries a fragment location', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        ...judgmentDocumentReference,
        ordinal: 12,
        paragraphNumber: 9,
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        ...legislationDocumentReference,
        labelPath: 'section/40',
      }),
    ).toThrow()
  })

  it('requires a granularity and the matching source type', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        sourceId: 'uksc-2099-1',
        ordinal: 12,
        paragraphNumber: 9,
      }),
    ).toThrow()
    // A document granularity on the provision source type is not a member.
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'document',
        sourceId: 'ukpga/2010/15',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'judgment',
        granularity: 'document',
        sourceId: 'uksc-2099-1',
        labelPath: 'section/40',
      }),
    ).toThrow()
  })

  it('keeps judgment and legislation locators from crossing', () => {
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
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
        ...judgmentDocumentReference,
        sourceId: 'a:judgment_document',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'a:legislation_provision:x',
        labelPath: 'y',
      }),
    ).toThrow()
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
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
          granularity: 'fragment',
          sourceId,
          labelPath: 'section/40',
        }),
      ).toThrow()
      expect(() =>
        evidenceReferenceSchema.parse({
          sourceType: 'legislation_document',
          granularity: 'document',
          sourceId,
        }),
      ).toThrow()
    }
    expect(() =>
      evidenceReferenceSchema.parse({
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2010/15',
        labelPath: '../../etc/passwd',
      }),
    ).toThrow()
  })
})

describe('Evidence reference identity', () => {
  it('is stable across identical references', () => {
    for (const reference of [
      judgmentReference,
      judgmentDocumentReference,
      legislationReference,
      legislationDocumentReference,
    ]) {
      expect(createEvidenceReferenceId(reference)).toBe(
        createEvidenceReferenceId({ ...reference }),
      )
    }
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

  it('gives the document forms their own deterministic, location-free ids', () => {
    expect(createEvidenceReferenceId(judgmentDocumentReference)).toBe(
      'uksc-2099-1:judgment_document',
    )
    expect(createEvidenceReferenceId(legislationDocumentReference)).toBe(
      'ukpga/2010/15:legislation_document',
    )
    // A document reference cannot collide with a fragment of the same source.
    expect(createEvidenceReferenceId(judgmentDocumentReference)).not.toBe(
      createEvidenceReferenceId(judgmentReference),
    )
    expect(createEvidenceReferenceId(legislationDocumentReference)).not.toBe(
      createEvidenceReferenceId(legislationReference),
    )
  })

  it('never collapses two schema-valid references into one id', () => {
    const references: EvidenceReference[] = [
      judgmentReference,
      { ...judgmentReference, sourceId: 'uksc-2099-2' },
      { ...judgmentReference, ordinal: 1, paragraphNumber: null },
      judgmentDocumentReference,
      { ...judgmentDocumentReference, sourceId: 'uksc-2099-2' },
      legislationReference,
      { ...legislationReference, labelPath: 'section/4' },
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/1998/42',
        labelPath: 'section/40',
      },
      legislationDocumentReference,
      { ...legislationDocumentReference, sourceId: 'ukpga/1998/42' },
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
    expect(JSON.parse(JSON.stringify(judgmentDocumentReference))).toEqual(
      judgmentDocumentReference,
    )
  })
})
