import { describe, expect, it, vi } from 'vitest'
import {
  resolveLegislationFetch,
  type LegislationServeDeps,
} from './legislation-serve'

const acts = [
  {
    identity: 'ukpga/2010/15',
    actType: 'ukpga',
    year: 2010,
    number: 15,
    title: 'Equality Act 2010',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    extent: 'E+W+S',
  },
]

const currentProvision = {
  id: 'ukpga/2010/15/section/13',
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/13',
  label: 's. 13',
  extent: 'E+W+S',
  text: 'Direct discrimination applies here.',
  hasUnappliedEffects: false,
  effectsCheckedAt: '2026-09-01T00:00:00Z',
  title: 'Equality Act 2010',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
}

const amendedProvision = {
  ...currentProvision,
  id: 'ukpga/2010/15/section/40',
  labelPath: 'section/40',
  label: 's. 40',
  text: 'Harassment text that must never serve.',
  hasUnappliedEffects: true,
}

function createDeps(overrides: {
  provision?: typeof currentProvision | null
  keywordHits?: Array<Record<string, unknown>>
  actsError?: boolean
}): LegislationServeDeps {
  const pool = {
    query: vi.fn(async (text: string) => {
      if (overrides.actsError) throw new Error('db down')
      if (text.includes('from legislation_documents order by'))
        return { rows: acts }
      if (text.includes('from legislation_documents\n')) return { rows: acts }
      if (text.includes('from legislation_documents')) {
        return {
          rows:
            text.includes('year = $1') || text.includes('identity = $1')
              ? acts
              : [],
        }
      }
      if (text.includes('from legislation_provisions')) {
        const rows =
          overrides.provision === null
            ? []
            : [overrides.provision ?? currentProvision]
        return { rows }
      }
      return { rows: [] }
    }),
  }
  const searchClient = {
    index: () => ({
      search: async () => ({
        hits: overrides.keywordHits ?? [],
        query: '',
        estimatedTotalHits: 0,
        processingTimeMs: 0,
      }),
    }),
  }
  return {
    pool: pool as unknown as LegislationServeDeps['pool'],
    searchClient:
      searchClient as unknown as LegislationServeDeps['searchClient'],
    indexName: 'legislation_provisions',
  }
}

describe('resolveLegislationFetch', () => {
  it('serves text for a provision with no effects', async () => {
    const result = await resolveLegislationFetch(
      createDeps({}),
      'section 13 Equality Act 2010',
    )
    expect(result.citationHeldExact).toBe(true)
    const hit = result.groups[0]?.hits[0]
    expect(hit?.legislationStatus).toBe('current')
    expect(hit?.text).toContain('Direct discrimination')
  })

  it('withholds text and links out for an amended provision', async () => {
    const result = await resolveLegislationFetch(
      createDeps({ provision: amendedProvision }),
      'Equality Act 2010 s. 40',
    )
    const hit = result.groups[0]?.hits[0]
    expect(hit?.legislationStatus).toBe('amended_not_held')
    expect(hit).not.toHaveProperty('text')
    expect(hit?.notice).toContain('does not hold the amended wording')
    expect(hit?.officialUrl).toBe(
      'https://www.legislation.gov.uk/ukpga/2010/15/section/40',
    )
  })

  it('reports a recognised but unheld provision visibly', async () => {
    const result = await resolveLegislationFetch(
      createDeps({ provision: null }),
      's 99 Equality Act 2010',
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('not held')
  })

  it('reports ambiguity with candidates, never a silent winner', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { ...acts[0], identity: 'ukpga/2020/1', title: 'Sample Act 2020' },
          { ...acts[0], identity: 'ukpga/2021/1', title: 'Sample Act 2020' },
        ],
      })),
    }
    const deps: LegislationServeDeps = {
      pool: pool as unknown as LegislationServeDeps['pool'],
      searchClient: createDeps({}).searchClient,
      indexName: 'legislation_provisions',
    }
    const result = await resolveLegislationFetch(deps, 'Sample Act 2020')
    expect(result.groups).toEqual([])
    expect(result.note).toContain('more than one')
  })

  it('leaves non-legislation queries to the judgment path', async () => {
    const result = await resolveLegislationFetch(
      createDeps({}),
      'Donoghue v Stevenson',
    )
    expect(result.groups).toEqual([])
    expect(result.citationRecognised).toBe(false)
  })

  it('fails open when the store is down', async () => {
    const result = await resolveLegislationFetch(
      createDeps({ actsError: true }),
      's 40 Equality Act 2010',
    )
    expect(result.groups).toEqual([])
    expect(result.note).toContain('unavailable')
  })
})
