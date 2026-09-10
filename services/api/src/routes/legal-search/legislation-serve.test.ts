import { describe, expect, it, vi } from 'vitest'
import {
  resolveLegislationFetch,
  resolveLegislationProvisionPage,
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
  year: 2010,
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

/** Legacy default row: false flag, but never checked (null timestamp). */
const uncheckedProvision = {
  ...currentProvision,
  effectsCheckedAt: null,
} as unknown as typeof currentProvision

function createDeps(overrides: {
  provision?: typeof currentProvision | null
  keywordHits?: Array<Record<string, unknown>>
  actsError?: boolean
}): LegislationServeDeps {
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
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
        // Keyed on the requested provision id: an unknown id is a store
        // miss (recognised_not_held), never a neighbouring row.
        if (overrides.provision === null) return { rows: [] }
        const stored = overrides.provision ?? currentProvision
        const wanted = values?.[0]
        if (typeof wanted === 'string' && wanted !== stored.id) {
          return { rows: [] }
        }
        return { rows: [stored] }
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
    expect(hit?.canonicalUrl).toBe('/ln/ukpga/2010/15/section/13')
    expect(hit?.year).toBe(2010)
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

  it('withholds text when the effects flag is undefined', async () => {
    // Fail-closed: only an explicit false serves text. A row predating the
    // flag (or any store shape that drops it) must land amended_not_held
    // with no text, never current.
    const flagless = {
      ...currentProvision,
      hasUnappliedEffects: undefined,
    } as unknown as typeof currentProvision
    const result = await resolveLegislationFetch(
      createDeps({ provision: flagless }),
      'section 13 Equality Act 2010',
    )
    expect(result.citationHeldExact).toBe(true)
    const hit = result.groups[0]?.hits[0]
    expect(hit?.legislationStatus).toBe('amended_not_held')
    expect(hit).not.toHaveProperty('text')
    expect(hit?.officialUrl).toBe(
      'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
    )
  })

  it('withholds text for an unchecked row even when the flag is false', async () => {
    // Legacy rows carry has_unapplied_effects=false with
    // effects_checked_at=null (migration default): never checked, never
    // known-good. Only a false flag WITH a check timestamp serves.
    const result = await resolveLegislationFetch(
      createDeps({ provision: uncheckedProvision }),
      'section 13 Equality Act 2010',
    )
    expect(result.citationHeldExact).toBe(true)
    const hit = result.groups[0]?.hits[0]
    expect(hit?.legislationStatus).toBe('amended_not_held')
    expect(hit).not.toHaveProperty('text')
    expect(hit?.officialUrl).toBe(
      'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
    )
  })

  it('withholds keyword hits whose effects were never checked', async () => {
    // A false flag without a check timestamp (stale index copy or an
    // unchecked legacy row) never serves text on the keyword path either.
    const uncheckedHit = {
      ...currentProvision,
      provisionRef: currentProvision.id,
      effectsCheckedAt: null,
    }
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [uncheckedHit] }),
      'direct discrimination',
    )
    const hit = result.groups[0]?.hits[0]
    expect(hit?.legislationStatus).toBe('amended_not_held')
    expect(hit).not.toHaveProperty('text')
  })

  it('serves the Act alone for an Act-name query, never tied provisions', async () => {
    // Every provision of an Act carries its title, so an Act-name query
    // matches all of them equally and the engine's tiebreak is the document
    // id — whose `schedule/` prefix sorts ahead of `section/`. The result was
    // a fixed handful of Schedule 1 paragraphs. The Act page carries the
    // contents instead, so the keyword hits must not be served at all.
    const scheduleParagraph = {
      ...currentProvision,
      id: 'ukpga/2010/15/schedule/1/paragraph/1',
      provisionRef: 'ukpga/2010/15/schedule/1/paragraph/1',
      labelPath: 'schedule/1/paragraph/1',
      label: 'Sch. 1 para. 1',
      text: 'Regulations may make provision for a condition of a prescribed description.',
    }
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [scheduleParagraph] }),
      'Equality Act 2010',
    )
    expect(result.citationHeldExact).toBe(true)
    expect(result.groups[0]?.hits).toHaveLength(1)
    const hit = result.groups[0]?.hits[0]
    expect(hit?.id).toBe('ukpga/2010/15')
    expect(hit?.labelPath).toBe('')
    // The row renders `provisionLabel · title`: the chapter number, not the
    // title a second time.
    expect(hit?.provisionLabel).toBe('2010 c. 15')
    expect(hit?.notice).toContain('browse its Parts, sections and schedules')
  })

  it('still serves provisions when the query carries more than the Act title', async () => {
    const keywordHit = {
      ...currentProvision,
      id: 'ukpga/2010/15/section/13',
      provisionRef: 'ukpga/2010/15/section/13',
    }
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [keywordHit] }),
      'direct discrimination',
    )
    expect(result.citationRecognised).toBe(false)
    expect(result.groups[0]?.hits).toHaveLength(1)
    expect(result.groups[0]?.hits[0]?.labelPath).toBe('section/13')
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

  it('never serves a neighbour for an unknown provision id', async () => {
    // Default store holds only s.13: s.99 resolves to a different
    // provision id, so the keyed lookup misses and the answer is
    // recognised_not_held with no group, not the s.13 text.
    const result = await resolveLegislationFetch(
      createDeps({}),
      's 99 Equality Act 2010',
    )
    expect(result.citationRecognised).toBe(true)
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

describe('resolveLegislationProvisionPage', () => {
  it('serves full text when effects are explicitly absent', async () => {
    const result = await resolveLegislationProvisionPage(
      createDeps({}).pool,
      currentProvision.id,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.provision.legislationStatus).toBe('current')
    expect(result.page.provision.text).toContain('Direct discrimination')
    expect(result.page.provision.canonicalUrl).toBe(
      '/ln/ukpga/2010/15/section/13',
    )
  })

  it('withholds text when effects are recorded', async () => {
    const result = await resolveLegislationProvisionPage(
      createDeps({ provision: amendedProvision }).pool,
      amendedProvision.id,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.provision.legislationStatus).toBe('amended_not_held')
    expect(result.page.provision).not.toHaveProperty('text')
    expect(result.page.provision.notice).toContain(
      'does not hold the amended wording',
    )
  })

  it('withholds full text for an unchecked false row on the page too', async () => {
    const result = await resolveLegislationProvisionPage(
      createDeps({ provision: uncheckedProvision }).pool,
      currentProvision.id,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.provision.legislationStatus).toBe('amended_not_held')
    expect(result.page.provision).not.toHaveProperty('text')
  })
})
