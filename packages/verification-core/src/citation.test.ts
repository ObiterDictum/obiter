import { describe, expect, it } from 'vitest'
import {
  citationInputSchema,
  draftLocationSchema,
  normalizedCitationSchema,
  normalizeLegislationCitationPath,
} from './index'

const citationText = '[2099] EWCA Civ 7'
const location = {
  paragraphId: 'p-7',
  start: 24,
  end: 24 + citationText.length,
}

describe('Citation input', () => {
  it('parses a citation with its draft location', () => {
    const citation = citationInputSchema.parse({
      rawText: citationText,
      location,
    })

    expect(citation.rawText).toBe(citationText)
    expect(citation.location.paragraphId).toBe('p-7')
  })

  it('keeps rawText verbatim, so it is the draft slice the location names', () => {
    const rawText = `  ${citationText}  `
    const citation = citationInputSchema.parse({
      rawText,
      location: { paragraphId: 'p-7', start: 0, end: rawText.length },
    })

    expect(citation.rawText).toBe(rawText)
  })

  it('rejects a blank citation and a location outside the citation length', () => {
    expect(() =>
      citationInputSchema.parse({ rawText: '   ', location }),
    ).toThrow()
    expect(() =>
      citationInputSchema.parse({
        rawText: citationText,
        location: { paragraphId: 'p-7', start: 24, end: 24 },
      }),
    ).toThrow()
    expect(() =>
      citationInputSchema.parse({
        rawText: citationText,
        location: { paragraphId: 'p-7', start: -1, end: 0 },
      }),
    ).toThrow()
    expect(() =>
      citationInputSchema.parse({
        rawText: citationText,
        location: {
          paragraphId: 'p-7',
          start: 24,
          end: 24 + citationText.length + 1,
        },
      }),
    ).toThrow()
  })
})

describe('Draft location offsets', () => {
  it('rejects a zero-length, reversed or negative span', () => {
    expect(() =>
      draftLocationSchema.parse({ paragraphId: 'p-7', start: 3, end: 3 }),
    ).toThrow()
    expect(() =>
      draftLocationSchema.parse({ paragraphId: 'p-7', start: 9, end: 3 }),
    ).toThrow()
    expect(() =>
      draftLocationSchema.parse({ paragraphId: 'p-7', start: -1, end: 1 }),
    ).toThrow()
  })

  it('allows adjacent half-open spans that share a boundary', () => {
    const first = draftLocationSchema.parse({
      paragraphId: 'p-7',
      start: 0,
      end: 5,
    })
    const second = draftLocationSchema.parse({
      paragraphId: 'p-7',
      start: first.end,
      end: 9,
    })

    expect(first.end).toBe(second.start)
  })

  it('measures an astral character as two UTF-16 code units', () => {
    // U+1F600 is one code point, two UTF-16 code units and four UTF-8 bytes.
    const rawText = '\u{1F600} [2099] EWCA Civ 7'
    expect(rawText.length).toBe(20)
    expect([...rawText].length).toBe(19)
    expect(Buffer.byteLength(rawText, 'utf8')).toBe(22)

    const parse = (end: number) =>
      citationInputSchema.parse({
        rawText,
        location: { paragraphId: 'p-7', start: 0, end },
      })

    expect(parse(20).rawText).toBe(rawText)
    expect(() => parse(19)).toThrow()
    expect(() => parse(22)).toThrow()
  })

  it('measures a combining mark as its own UTF-16 code unit', () => {
    // `e` plus U+0301: two UTF-16 code units, two code points, three UTF-8 bytes.
    const rawText = `e\u0301 ${citationText}`
    expect(rawText.length).toBe(20)
    expect([...rawText].length).toBe(20)
    expect(Buffer.byteLength(rawText, 'utf8')).toBe(21)

    const parse = (end: number) =>
      citationInputSchema.parse({
        rawText,
        location: { paragraphId: 'p-7', start: 0, end },
      })

    expect(parse(20).rawText).toBe(rawText)
    expect(() => parse(19)).toThrow()
    expect(() => parse(21)).toThrow()
  })

  it('measures a line break as a single code unit', () => {
    const rawText = `a\n${citationText}`
    expect(rawText.length).toBe(19)

    const parse = (end: number) =>
      citationInputSchema.parse({
        rawText,
        location: { paragraphId: 'p-7', start: 0, end },
      })

    expect(parse(19).rawText).toBe(rawText)
    expect(() => parse(18)).toThrow()
  })
})

describe('Normalized citation', () => {
  it('parses each resolved kind', () => {
    expect(
      normalizedCitationSchema.parse({
        kind: 'case_law',
        neutralCitation: citationText,
        sourceId: 'uksc-2099-1',
      }),
    ).toEqual({
      kind: 'case_law',
      neutralCitation: citationText,
      sourceId: 'uksc-2099-1',
    })

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

    expect(normalizedCitationSchema.parse({ kind: 'not_checked' })).toEqual({
      kind: 'not_checked',
    })
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

  it('gives a resolved case citation the authority id evidence can be compared with', () => {
    expect(() =>
      normalizedCitationSchema.parse({
        kind: 'case_law',
        neutralCitation: citationText,
      }),
    ).toThrow()
    expect(() =>
      normalizedCitationSchema.parse({
        kind: 'case_law',
        neutralCitation: citationText,
        sourceId: '',
      }),
    ).toThrow()
    expect(() =>
      normalizedCitationSchema.parse({
        kind: 'case_law',
        neutralCitation: citationText,
        sourceId: 'uksc:2099:1',
      }),
    ).toThrow()
  })

  it('accepts only canonical legislation identities', () => {
    const parse = (documentIdentity: string, labelPath: string | null) =>
      normalizedCitationSchema.parse({
        kind: 'legislation',
        documentIdentity,
        labelPath,
      })

    expect(parse('ukpga/2010/15', 'section/40')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: 'section/40',
    })
    expect(parse('ukpga/2010/15', null)).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: null,
    })

    for (const identity of [
      'garbage',
      'ukpga/2010',
      'ukpga/2010/15/',
      'ukpga//15',
      'ukpga/2010/15/section/40',
      'UKPGA/2010/15',
      'ukpga/2010/15%2f..',
      'uksi/2020/1',
    ]) {
      expect(() => parse(identity, null)).toThrow()
    }
  })

  it('rejects traversal-like, empty and malformed label paths', () => {
    for (const labelPath of [
      '../../etc/passwd',
      'section/..',
      'section/./40',
      'section//40',
      '/section/40',
      'section/40/',
      'section/%2e%2e',
      'section/40%2f..',
      'section/ 40',
      'section\\40',
    ]) {
      expect(() =>
        normalizedCitationSchema.parse({
          kind: 'legislation',
          documentIdentity: 'ukpga/2010/15',
          labelPath,
        }),
      ).toThrow()
    }
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

  it('treats a canonical Act path as the whole Act', () => {
    expect(normalizeLegislationCitationPath('/ln/ukpga/2010/15')).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: null,
    })
  })

  it('requires the canonical /ln/ prefix', () => {
    expect(normalizeLegislationCitationPath('ukpga/2010/15')).toBeNull()
    expect(
      normalizeLegislationCitationPath('ukpga/2010/15/section/40'),
    ).toBeNull()
    expect(normalizeLegislationCitationPath('/lnukpga/2010/15')).toBeNull()
  })

  it('rejects traversal-like, empty and malformed segments', () => {
    expect(
      normalizeLegislationCitationPath('/ln/ukpga/2010/15/../../x'),
    ).toBeNull()
    expect(normalizeLegislationCitationPath('/ln/ukpga/2010/15/')).toBeNull()
    expect(
      normalizeLegislationCitationPath('/ln/ukpga/2010/15//section/40'),
    ).toBeNull()
    expect(
      normalizeLegislationCitationPath('/ln/ukpga/2010/15/section/%2e%2e'),
    ).toBeNull()
  })

  it('leaves free-text and non-legislation citations to the layers that own them', () => {
    expect(normalizeLegislationCitationPath('[2099] EWCA Civ 7')).toBeNull()
    expect(
      normalizeLegislationCitationPath('s 40 Equality Act 2010'),
    ).toBeNull()
    expect(normalizeLegislationCitationPath('/ln/ukpga/2010')).toBeNull()
  })
})
