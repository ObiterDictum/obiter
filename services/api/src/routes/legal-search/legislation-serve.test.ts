import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  resolveLegislationFetch,
  resolveLegislationProvisionPage,
  type LegislationServeDeps,
} from './legislation-serve'
import { parseScheduleLabelPath } from './legislation-citations'

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

const uncheckedProvision = {
  ...currentProvision,
  effectsCheckedAt: null,
} as unknown as typeof currentProvision

function createDeps(overrides: {
  provision?: typeof currentProvision | null
  keywordHits?: Array<Record<string, unknown>>
  actsError?: boolean
  directoryActs?: typeof acts
}): LegislationServeDeps {
  const directoryActs = overrides.directoryActs ?? acts
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (overrides.actsError) throw new Error('db down')
      if (text.includes('from legislation_documents order by'))
        return { rows: directoryActs }
      if (text.includes('from legislation_documents\n'))
        return { rows: directoryActs }
      if (text.includes('from legislation_documents')) {
        return {
          rows:
            text.includes('year = $1') || text.includes('identity = $1')
              ? directoryActs
              : [],
        }
      }
      if (text.includes('from legislation_provisions')) {
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
    expect(result.keywordSearchParameters).toBe(null)
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
    expect(result.keywordSearchParameters).toEqual({
      matchingStrategy: 'all',
      rankingScoreThreshold: 0.35,
    })
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
    const result = await resolveLegislationFetch(
      createDeps({}),
      's 99 Equality Act 2010',
    )
    expect(result.citationRecognised).toBe(true)
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('not held')
  })

  it('reports an unresolved Act title, never keyword provisions and never not-held', async () => {
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2026/21/section/12',
      documentIdentity: 'ukpga/2026/21',
      labelPath: 'section/12',
      title: "Children's Wellbeing and Schools Act 2026",
      text: 'A provision that shares a word with the title is not an answer.',
    }
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [neighbour] }),
      'Children Act 1989',
    )
    expect(result.citationRecognised).toBe(true)
    expect(result.titleUnresolved).toBe(true)
    expect(result.recognisedNotHeld).toBe(false)
    expect(result.citationHeldExact).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('No exact legislation title match')
    expect(result.note).toContain('Children Act 1989')
    expect(result.keywordSearchParameters).toBe(null)
  })

  it('suppresses an attached-opener bracketed held title with zero hits', async () => {
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2022/32/section/166',
      documentIdentity: 'ukpga/2022/32',
      labelPath: 'section/166',
      title: 'Police, Crime, Sentencing and Courts Act 2022',
      text: 'A provision of an unrelated Act that must never serve.',
    }
    for (const query of [
      'Amendment of (Equality Act 2010) Act 2020',
      'Amendment of ( Equality Act 2010 ) Act 2020',
      'X [Equality Act 2010] Act 2020',
      'X {Equality Act 2010} Act 2020',
      'X { Equality Act 2010 } Act 2020',
    ]) {
      const result = await resolveLegislationFetch(
        createDeps({ keywordHits: [neighbour] }),
        query,
      )
      expect(result.citationRecognised).toBe(true)
      expect(result.titleUnresolved).toBe(true)
      expect(result.recognisedNotHeld).toBe(false)
      expect(result.groups).toEqual([])
      expect(result.keywordSearchParameters).toBe(null)
    }
  })

  it('serves keyword provisions for attached-opener prose about a held Act', async () => {
    const directoryActs = [
      ...acts,
      {
        identity: 'ukpga/1998/42',
        actType: 'ukpga',
        year: 1998,
        number: 42,
        title: 'Human Rights Act 1998',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/1998/42',
        extent: 'E+W+S',
      },
      {
        identity: 'ukpga/2023/51',
        actType: 'ukpga',
        year: 2023,
        number: 51,
        title: 'Worker Protection (Amendment of Equality Act 2010) Act 2023',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2023/51',
        extent: 'E+W+S',
      },
    ]
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2022/32/section/166',
      provisionRef: 'ukpga/2022/32/section/166',
      documentIdentity: 'ukpga/2022/32',
      labelPath: 'section/166',
      title: 'Police, Crime, Sentencing and Courts Act 2022',
      text: 'A provision served only for genuine prose.',
    }
    for (const query of [
      'Duties under(Equality Act 2010)',
      'Duties under (Equality Act 2010)',
      'Defences under[Children Act 1989]',
      'Provisions of{Human Rights Act 1998}',
      'Duties under(Equality Act 2010) Act 2020',
    ]) {
      const result = await resolveLegislationFetch(
        createDeps({ directoryActs, keywordHits: [neighbour] }),
        query,
      )
      expect(result.titleUnresolved).toBe(false)
      expect(result.recognisedNotHeld).toBe(false)
      expect(result.groups[0]?.hits[0]?.id).toBe(neighbour.id)
      expect(result.keywordSearchParameters).not.toBe(null)
    }
    for (const query of [
      'Worker Protection (Amendment of Equality Act 2010) Act 2010',
      'X ((Equality Act 2010)) Act 2020',
      'X (Equality Act 2010 Act 2020',
    ]) {
      const result = await resolveLegislationFetch(
        createDeps({ directoryActs, keywordHits: [neighbour] }),
        query,
      )
      expect(result.titleUnresolved).toBe(true)
      expect(result.recognisedNotHeld).toBe(false)
      expect(result.groups).toEqual([])
      expect(result.keywordSearchParameters).toBe(null)
    }
  })

  it('serves keyword provisions for prose about an unheld Act, in both casings', async () => {
    const directoryActs = [
      ...acts,
      {
        identity: 'ukpga/2023/42',
        actType: 'ukpga',
        year: 2023,
        number: 42,
        title: 'Powers of Attorney Act 2023',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2023/42',
        extent: 'E+W',
      },
      {
        identity: 'ukpga/2022/32',
        actType: 'ukpga',
        year: 2022,
        number: 32,
        title: 'Police, Crime, Sentencing and Courts Act 2022',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2022/32',
        extent: 'E+W',
      },
    ]
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2026/21/section/12',
      provisionRef: 'ukpga/2026/21/section/12',
      documentIdentity: 'ukpga/2026/21',
      labelPath: 'section/12',
      title: "Children's Wellbeing and Schools Act 2026",
      text: 'A provision that shares a word with the title.',
    }
    for (const query of [
      'Defences under Children Act 1989',
      'defences under Children Act 1989',
    ]) {
      const result = await resolveLegislationFetch(
        createDeps({ directoryActs, keywordHits: [neighbour] }),
        query,
      )
      expect(result.titleUnresolved).toBe(false)
      expect(result.recognisedNotHeld).toBe(false)
      expect(result.groups[0]?.hits[0]?.id).toBe(neighbour.id)
      expect(result.keywordSearchParameters).not.toBe(null)
    }
  })

  it('suppresses a standalone nested outer title without serving keyword provisions', async () => {
    const directoryActs = [
      ...acts,
      {
        identity: 'ukpga/2023/51',
        actType: 'ukpga',
        year: 2023,
        number: 51,
        title: 'Worker Protection (Amendment of Equality Act 2010) Act 2023',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2023/51',
        extent: 'E+W+S',
      },
    ]
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2023/51/section/1',
      provisionRef: 'ukpga/2023/51/section/1',
      documentIdentity: 'ukpga/2023/51',
      labelPath: 'section/1',
      title: 'Worker Protection (Amendment of Equality Act 2010) Act 2023',
      text: 'A provision of the 2023 Act that must not answer the 2010 outer title.',
    }
    const result = await resolveLegislationFetch(
      createDeps({ directoryActs, keywordHits: [neighbour] }),
      'Worker Protection (Amendment of Equality Act 2010) Act 2010',
    )
    expect(result.titleUnresolved).toBe(true)
    expect(result.citationHeldExact).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.keywordSearchParameters).toBe(null)
  })

  it('suppresses an unheld title carrying the terminal ", as amended" qualifier', async () => {
    const neighbour = {
      ...currentProvision,
      id: 'ukpga/2026/21/section/12',
      provisionRef: 'ukpga/2026/21/section/12',
      documentIdentity: 'ukpga/2026/21',
      labelPath: 'section/12',
      title: "Children's Wellbeing and Schools Act 2026",
      text: 'A provision that shares a word with the title is not an answer.',
    }
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [neighbour] }),
      'Children Act 1989, as amended',
    )
    expect(result.titleUnresolved).toBe(true)
    expect(result.citationHeldExact).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.keywordSearchParameters).toBe(null)
  })

  it('reports an unheld chapter number as not held', async () => {
    const result = await resolveLegislationFetch(
      createDeps({ keywordHits: [currentProvision] }),
      '2008 c. 12',
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.groups).toEqual([])
    expect(result.note).toBe('2008 c. 12 is not held.')
  })

  it('folds a straight apostrophe to a curly stored Act title', async () => {
    const curlyActs = [
      {
        identity: 'ukpga/2025/26',
        actType: 'ukpga',
        year: 2025,
        number: 26,
        title: 'Renters’ Rights Act 2025',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2025/26',
        extent: 'E+W',
      },
    ]
    const deps: LegislationServeDeps = {
      pool: {
        query: vi.fn(async () => ({ rows: curlyActs })),
      } as unknown as LegislationServeDeps['pool'],
      searchClient: createDeps({}).searchClient,
      indexName: 'legislation_provisions',
    }
    const result = await resolveLegislationFetch(
      deps,
      "Renters' Rights Act 2025",
    )
    expect(result.citationHeldExact).toBe(true)
    expect(result.groups[0]?.hits[0]?.documentIdentity).toBe('ukpga/2025/26')
  })

  it('reports ambiguity as its own state, never not-held', async () => {
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
    expect(result.ambiguous).toBe(true)
    expect(result.recognisedNotHeld).toBe(false)
    expect(result.titleUnresolved).toBe(false)
    expect(result.note).toContain('more than one')
  })

  it('resolves a short title whose stored title carries (repealed)', async () => {
    const repealedActs = [
      {
        identity: 'ukpga/2021/28',
        actType: 'ukpga',
        year: 2021,
        number: 28,
        title: 'Health and Social Care Levy Act 2021 (repealed)',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/2021/28',
        extent: 'E+W+S',
      },
    ]
    const deps: LegislationServeDeps = {
      pool: {
        query: vi.fn(async (text: string) => {
          if (text.includes('from legislation_documents order by'))
            return { rows: repealedActs }
          if (text.includes('from legislation_documents'))
            return { rows: repealedActs }
          return { rows: [] }
        }),
      } as unknown as LegislationServeDeps['pool'],
      searchClient: createDeps({}).searchClient,
      indexName: 'legislation_provisions',
    }
    const result = await resolveLegislationFetch(
      deps,
      'Health and Social Care Levy Act 2021',
    )
    expect(result.citationHeldExact).toBe(true)
    expect(result.recognisedNotHeld).toBe(false)
    expect(result.titleUnresolved).toBe(false)
    expect(result.groups[0]?.hits[0]?.documentIdentity).toBe('ukpga/2021/28')
  })

  it('leaves non-legislation queries to the judgment path', async () => {
    const result = await resolveLegislationFetch(
      createDeps({}),
      'Donoghue v Stevenson',
    )
    expect(result.groups).toEqual([])
    expect(result.citationRecognised).toBe(false)
  })

  it('does not throw on a query naming an inherited Object property', async () => {
    await expect(
      resolveLegislationFetch(createDeps({}), 'constructor'),
    ).resolves.toMatchObject({ citationRecognised: false, searched: true })
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

describe('single-schedule storage shape (adjacent board finding)', () => {
  const carersLeave = {
    identity: 'ukpga/2023/18',
    actType: 'ukpga',
    year: 2023,
    number: 18,
    title: "Carer's Leave Act 2023",
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2023/18',
    extent: 'E+W+S',
  }

  const carerParagraph = {
    ...currentProvision,
    id: 'ukpga/2023/18/schedule/paragraph/2',
    documentIdentity: 'ukpga/2023/18',
    labelPath: 'schedule/paragraph/2',
    label: 'Sch. paragraph 2',
    title: "Carer's Leave Act 2023",
    year: 2023,
    text: 'An employee is entitled to carer’s leave.',
  }

  const equalityScheduleParagraph = {
    ...currentProvision,
    id: 'ukpga/2010/15/schedule/1/paragraph/2',
    labelPath: 'schedule/1/paragraph/2',
    label: 'Sch. 1 para. 2',
  }

  function createScheduleDeps(rows: Array<typeof currentProvision>) {
    const pool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text.includes('from legislation_documents order by'))
          return { rows: [acts[0], carersLeave] }
        if (text.includes('select exists')) {
          const [identity, prefix] = values as [string, string]
          const exists = rows.some(
            (row) =>
              row.documentIdentity === identity &&
              (row.labelPath === prefix ||
                row.labelPath.startsWith(`${prefix}/`)),
          )
          return { rows: [{ exists }] }
        }
        if (text.includes('from legislation_provisions')) {
          const wanted = values?.[0]
          const row = rows.find((candidate) => candidate.id === wanted)
          return { rows: row ? [row] : [] }
        }
        return { rows: [] }
      }),
    }
    return {
      pool: pool as unknown as LegislationServeDeps['pool'],
      searchClient: createDeps({}).searchClient,
      indexName: 'legislation_provisions',
    } satisfies LegislationServeDeps
  }

  const rows = [carerParagraph, equalityScheduleParagraph]

  it.each([
    [
      "Schedule 1 paragraph 2 Carer's Leave Act 2023",
      'ukpga/2023/18/schedule/paragraph/2',
    ],
    [
      "Sch. para. 2 Carer's Leave Act 2023",
      'ukpga/2023/18/schedule/paragraph/2',
    ],
    [
      "para. 2 Sch. 1 Carer's Leave Act 2023",
      'ukpga/2023/18/schedule/paragraph/2',
    ],
  ])('resolves %s to the stored single-schedule path', async (query, id) => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      query,
    )
    expect(result.citationHeldExact).toBe(true)
    expect(result.recognisedNotHeld).toBe(false)
    const hit = result.groups[0]?.hits[0]
    expect(hit?.id).toBe(id)
    expect(hit?.officialUrl).toBe(`https://www.legislation.gov.uk/${id}`)
  })

  it('never maps Schedule 2 onto the unnumbered single schedule', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      "Schedule 2 paragraph 2 Carer's Leave Act 2023",
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.groups).toEqual([])
    expect(result.note).toContain('not held')
    expect(result.note).toContain('/schedule/2/paragraph/2')
  })

  it('keeps the numbered path when the Act holds it', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Schedule 1 paragraph 2 Equality Act 2010',
    )
    expect(result.groups[0]?.hits[0]?.id).toBe(
      'ukpga/2010/15/schedule/1/paragraph/2',
    )
  })

  it('keeps the missing-provision distinction for a numbered Act', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Schedule 9 paragraph 1 Equality Act 2010',
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.note).toContain('/schedule/9/paragraph/1')
  })

  it('reports a missing paragraph of the single schedule as not held', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      "Schedule 1 paragraph 999 Carer's Leave Act 2023",
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.note).toContain('/schedule/paragraph/999')
  })

  it('does not guess a schedule for an unnumbered citation on a numbered Act', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Sch. para. 2 Equality Act 2010',
    )
    expect(result.groups).toEqual([])
    expect(result.recognisedNotHeld).toBe(false)
    expect(result.note).toContain('names no schedule')
  })

  it('suggests an underspecified-schedule example the citation parser accepts', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Sch. para. 2 Equality Act 2010',
    )
    const example = result.note?.match(/for example "([^"]+)"/)?.[1]
    expect(example).toBe('Schedule 1 paragraph 2')
    expect(parseScheduleLabelPath(example ?? '')).toBe('schedule/1/paragraph/2')
  })

  it('resolves its own underspecified-schedule example back to the provision', async () => {
    const first = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Sch. para. 2 Equality Act 2010',
    )
    const example = first.note?.match(/for example "([^"]+)"/)?.[1]
    expect(example).toBe('Schedule 1 paragraph 2')
    const second = await resolveLegislationFetch(
      createScheduleDeps(rows),
      `${example} Equality Act 2010`,
    )
    expect(second.citationHeldExact).toBe(true)
    expect(second.recognisedNotHeld).toBe(false)
    expect(second.groups[0]?.hits[0]?.id).toBe(
      'ukpga/2010/15/schedule/1/paragraph/2',
    )
  })

  it('returns a structured underspecified-schedule diagnostic the client can resubmit', async () => {
    const first = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Sch. para. 2 Equality Act 2010',
    )
    const guidance = first.scheduleUnderspecified
    if (!guidance) throw new Error('expected structured schedule guidance')
    expect(guidance.example).toBe('Schedule 1 paragraph 2')
    expect(guidance.actTitle).toBe('Equality Act 2010')
    const second = await resolveLegislationFetch(
      createScheduleDeps(rows),
      `${guidance.example} ${guidance.actTitle}`,
    )
    expect(second.citationHeldExact).toBe(true)
    expect(second.recognisedNotHeld).toBe(false)
    expect(second.groups[0]?.hits[0]?.id).toBe(
      'ukpga/2010/15/schedule/1/paragraph/2',
    )
  })

  it('marks an underspecified schedule as a corrective, never a not-held verdict', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      'Sch. para. 2 Equality Act 2010',
    )
    expect(result.recognisedNotHeld).toBe(false)
    expect(result.titleUnresolved).toBe(false)
    expect(result.ambiguous).toBe(false)
    expect(result.scheduleUnderspecified).not.toBeNull()
  })

  it('keeps the Equality Act 2010 s. 999 missing-provision message', async () => {
    const result = await resolveLegislationFetch(
      createScheduleDeps(rows),
      's. 999 Equality Act 2010',
    )
    expect(result.recognisedNotHeld).toBe(true)
    expect(result.note).toContain('s. 999 of Equality Act 2010 is not held')
    expect(result.note).toContain(
      'https://www.legislation.gov.uk/ukpga/2010/15/section/999',
    )
  })
})

describe('resolveLegislationFetch — P1.34 legislation keyword bound', () => {
  const keywordQuery = 'appeal a housing decision'

  type KeywordEngineResponse = {
    hits: Array<Record<string, unknown>>
    query?: string
    estimatedTotalHits?: number
    processingTimeMs?: number
  }
  type KeywordSearch = (
    query: string,
    options: Record<string, unknown>,
    extraRequestInit?: { signal?: AbortSignal | null },
  ) => Promise<KeywordEngineResponse>

  function keywordDeps(
    search: KeywordSearch,
    keywordTimeoutMs = 40,
  ): LegislationServeDeps {
    return {
      pool: {
        query: vi.fn(async (text: string) =>
          text.includes('from legislation_documents order')
            ? { rows: acts }
            : { rows: [] },
        ),
      } as unknown as LegislationServeDeps['pool'],
      searchClient: {
        index: () => ({ search }),
      } as unknown as LegislationServeDeps['searchClient'],
      indexName: 'legislation_provisions',
      keywordTimeoutMs,
    }
  }

  it('classifies a hung keyword engine as failed, never a completed empty', async () => {
    let engineSignal: AbortSignal | null | undefined
    const result = await resolveLegislationFetch(
      keywordDeps((_query, _options, extraRequestInit) => {
        engineSignal = extraRequestInit?.signal
        return new Promise<never>(() => undefined)
      }),
      keywordQuery,
    )
    expect(result.failed).toBe(true)
    expect(result.searched).toBe(false)
    expect(result.groups).toEqual([])
    expect(result.note).toBe('Legislation index unavailable.')
    expect(engineSignal?.aborted).toBe(true)
  })

  it('discards a keyword search that resolves after the deadline', async () => {
    let resolveLate: (value: KeywordEngineResponse) => void = () => undefined
    const late = new Promise<KeywordEngineResponse>((resolve) => {
      resolveLate = resolve
    })
    const result = await resolveLegislationFetch(
      keywordDeps(() => late),
      keywordQuery,
    )
    expect(result.failed).toBe(true)
    expect(result.searched).toBe(false)
    resolveLate({
      hits: [],
      query: keywordQuery,
      estimatedTotalHits: 0,
      processingTimeMs: 0,
    })
    await Promise.resolve()
    const next = await resolveLegislationFetch(
      keywordDeps(async () => ({
        hits: [],
        query: keywordQuery,
        estimatedTotalHits: 0,
        processingTimeMs: 0,
      })),
      keywordQuery,
    )
    expect(next.failed).toBe(false)
    expect(next.searched).toBe(true)
  })

  it('handles a keyword search that rejects after the deadline', async () => {
    let rejectLate: (error: unknown) => void = () => undefined
    const late = new Promise<KeywordEngineResponse>((_resolve, reject) => {
      rejectLate = reject
    })
    const result = await resolveLegislationFetch(
      keywordDeps(() => late),
      keywordQuery,
    )
    expect(result.failed).toBe(true)
    rejectLate(new Error('late engine rejection'))
    await Promise.resolve()
    await Promise.resolve()
    expect(result.failed).toBe(true)
  })

  it('keeps a fast keyword answer independent of a concurrent hang', async () => {
    const hung = keywordDeps(() => new Promise<never>(() => undefined), 200)
    const fast = keywordDeps(async () => ({
      hits: [],
      query: keywordQuery,
      estimatedTotalHits: 0,
      processingTimeMs: 0,
    }))
    const [hungResult, fastResult] = await Promise.all([
      resolveLegislationFetch(hung, keywordQuery),
      resolveLegislationFetch(fast, keywordQuery),
    ])
    expect(hungResult.failed).toBe(true)
    expect(fastResult.failed).toBe(false)
    expect(fastResult.searched).toBe(true)
  })
})
