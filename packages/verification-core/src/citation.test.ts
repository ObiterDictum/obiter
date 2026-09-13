import { describe, expect, it } from 'vitest'
import {
  citationInputSchema,
  normalizedCitationSchema,
  normalizeLegislationCitationPath,
} from './index'

const location = { paragraphId: 'p-7', start: 24, end: 40 }

describe('Citation input', () => {
  it('parses a citation with its draft location', () => {
    const citation = citationInputSchema.parse({
      rawText: '[2099] EWCA Civ 7',
      location,
    })

    expect(citation.rawText).toBe('[2099] EWCA Civ 7')
    expect(citation.location.paragraphId).toBe('p-7')
  })

  it('rejects an empty citation and a location that ends at or before it starts', () => {
    expect(() =>
      citationInputSchema.parse({ rawText: '   ', location }),
    ).toThrow()
    expect(() =>
      citationInputSchema.parse({
        rawText: '[2099] EWCA Civ 7',
        location: { paragraphId: 'p-7', start: 24, end: 24 },
      }),
    ).toThrow()
    expect(() =>
      citationInputSchema.parse({
        rawText: '[2099] EWCA Civ 7',
        location: { paragraphId: 'p-7', start: -1, end: 0 },
      }),
    ).toThrow()
  })
})

describe('Normalized citation', () => {
  it('parses each resolved kind', () => {
    expect(
      normalizedCitationSchema.parse({
        kind: 'case_law',
        neutralCitation: '[2099] EWCA Civ 7',
      }),
    ).toEqual({ kind: 'case_law', neutralCitation: '[2099] EWCA Civ 7' })

    expect(
      normalizedCitationSchema.parse({
        kind: 'legislation',
        documentIdentity: 'ukpga/2010/15',
        labelPath: 'section/40',
      }),
    ).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: 'section/40',
    })

    expect(
      normalizedCitationSchema.parse({
        kind: 'unresolved',
        reason: 'ambiguous',
      }),
    ).toEqual({ kind: 'unresolved', reason: 'ambiguous' })
  })

  it('rejects an unknown kind, an unknown reason and an empty identity', () => {
    expect(() => normalizedCitationSchema.parse({ kind: 'statute' })).toThrow()
    expect(() =>
      normalizedCitationSchema.parse({
        kind: 'unresolved',
        reason: 'unknown',
      }),
    ).toThrow()
    expect(() =>
      normalizedCitationSchema.parse({
        kind: 'legislation',
        documentIdentity: '',
        labelPath: null,
      }),
    ).toThrow()
  })
})

describe('Canonical legislation path normalisation', () => {
  it('reduces a canonical provision path to its source identity', () => {
    expect(
      normalizeLegislationCitationPath('/ln/ukpga/2010/15/section/40'),
    ).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: 'section/40',
    })
  })

  it('treats an Act path as the whole Act', () => {
    expect(normalizeLegislationCitationPath('/ln/ukpga/2010/15')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: null,
    })
  })

  it('leaves free-text and non-legislation citations to the layers that own them', () => {
    expect(normalizeLegislationCitationPath('[2099] EWCA Civ 7')).toBeNull()
    expect(
      normalizeLegislationCitationPath('s 40 Equality Act 2010'),
    ).toBeNull()
    expect(normalizeLegislationCitationPath('/ln/ukpga/2010')).toBeNull()
  })
})
