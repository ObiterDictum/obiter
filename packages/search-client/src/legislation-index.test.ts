import { describe, expect, it } from 'vitest'
import {
  createLegislationIndex,
  indexLegislationProvisions,
  isLegislationProvisionDocument,
  legislationSearchIndexSettings,
  searchLegislation,
  type LegislationProvisionDocument,
} from './legislation-index'

const provision: LegislationProvisionDocument = {
  id: 'ukpga-2020-1-section-13-2',
  provisionRef: 'ukpga/2020/1/section/13/2',
  documentIdentity: 'ukpga/2020/1',
  actType: 'ukpga',
  year: 2020,
  number: 1,
  title: 'Sample Act 2020',
  label: 's. 13(2)',
  labelPath: 'section/13/2',
  extent: 'E+W',
  text: 'Duties extend to agents.',
  hasUnappliedEffects: false,
  effectsCheckedAt: '2026-09-01T00:00:00Z',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2020/1',
}

/**
 * The engine client returns the task promise itself with waitTask attached,
 * not a promise of a task object: awaiting resolves the EnqueuedTask while
 * .waitTask stays available on the promise. Mocks repeat that shape.
 */
function enqueuedTask(
  result: { status?: string; error?: { code?: string } },
  taskUid = 1,
) {
  return Object.assign(Promise.resolve({ taskUid }), {
    waitTask: async () => result,
  })
}

describe('legislation provision index', () => {
  it('configures identifiers and titles ahead of body text', async () => {
    const calls: string[][] = []
    const task = enqueuedTask({ status: 'succeeded' })
    const client = {
      createIndex: () => task,
      index: () => ({
        updateSearchableAttributes: (attributes: string[]) => {
          calls.push(attributes)
          return task
        },
        updateFilterableAttributes: () => task,
        updateSortableAttributes: () => task,
        updateRankingRules: () => task,
        getPrefixSearch: async () => 'disabled',
        updatePrefixSearch: () => task,
        updateStopWords: () => task,
        updateTypoTolerance: () => task,
      }),
    }
    await createLegislationIndex(
      client as unknown as Parameters<typeof createLegislationIndex>[0],
      'legislation_provisions',
    )
    const searchable = calls[0] ?? []
    expect(searchable.indexOf('text')).toBeGreaterThan(
      searchable.indexOf('title'),
    )
    expect(searchable).toContain('provisionRef')
  })

  it('uses a provisional floor stricter than the judgment 0.25', () => {
    expect(legislationSearchIndexSettings.rankingScoreThreshold).toBe(0.35)
  })

  it('requires every query term rather than dropping the ones that miss', async () => {
    const queries: Array<Record<string, unknown>> = []
    const client = {
      index: () => ({
        search: async (_query: string, options: Record<string, unknown>) => {
          queries.push(options)
          return {
            hits: [],
            query: '',
            estimatedTotalHits: 0,
            processingTimeMs: 0,
          }
        },
      }),
    }
    await searchLegislation(
      client as unknown as Parameters<typeof searchLegislation>[0],
      'legislation_provisions',
      'Human Rights Act 1998 proportionality',
    )
    expect(queries[0]?.matchingStrategy).toBe('all')
  })

  it('validates provision records at the boundary', () => {
    expect(isLegislationProvisionDocument(provision)).toBe(true)
    expect(isLegislationProvisionDocument({ ...provision, text: 42 })).toBe(
      false,
    )
    expect(
      isLegislationProvisionDocument({ ...provision, provisionRef: undefined }),
    ).toBe(false)
  })

  it('requires the effects flag, fail-closed without it', () => {
    const { hasUnappliedEffects: _dropped, ...flagless } = provision
    expect(isLegislationProvisionDocument(flagless)).toBe(false)
    expect(
      isLegislationProvisionDocument({ ...provision, hasUnappliedEffects: 0 }),
    ).toBe(false)
    expect(
      isLegislationProvisionDocument({
        ...provision,
        hasUnappliedEffects: true,
      }),
    ).toBe(true)
  })

  it('requires check provenance, fail-closed without it', () => {
    const { effectsCheckedAt: _dropped, ...provenanceless } = provision
    expect(isLegislationProvisionDocument(provenanceless)).toBe(false)
    expect(
      isLegislationProvisionDocument({
        ...provision,
        effectsCheckedAt: null,
      }),
    ).toBe(true)
  })

  it('indexes batches and names the provider error on failure', async () => {
    const seen: unknown[][] = []
    const client = {
      index: () => ({
        addDocuments: (documents: unknown[]) => {
          seen.push(documents)
          return enqueuedTask(
            { status: 'failed', error: { code: 'invalid_document_id' } },
            2,
          )
        },
      }),
    }
    const result = await indexLegislationProvisions(
      client as unknown as Parameters<typeof indexLegislationProvisions>[0],
      'legislation_provisions',
      [provision],
    )
    expect(result.failedCount).toBe(1)
    expect(result.errors[0]?.message).toContain('invalid_document_id')
    expect(seen).toHaveLength(1)
  })

  it('searches exact phrases for citations and applies the provisional floor', async () => {
    const queries: Array<{ query: string; options: Record<string, unknown> }> =
      []
    const client = {
      index: () => ({
        search: async (query: string, options: Record<string, unknown>) => {
          queries.push({ query, options })
          return { hits: [], query, estimatedTotalHits: 0, processingTimeMs: 0 }
        },
      }),
    }
    await searchLegislation(
      client as unknown as Parameters<typeof searchLegislation>[0],
      'legislation_provisions',
      's. 13(2)',
      { exactPhrase: 's. 13(2)', limit: 5 },
    )
    expect(queries[0]?.query).toBe('"s. 13(2)"')
    expect(queries[0]?.options.rankingScoreThreshold).toBe(0.35)
    expect(queries[0]?.options.limit).toBe(5)
  })

  it('drops index rows that fail validation instead of serving them', async () => {
    const client = {
      index: () => ({
        search: async () => ({
          hits: [{ id: 'junk' }, provision],
          query: 'duties',
          estimatedTotalHits: 2,
          processingTimeMs: 0,
        }),
      }),
    }
    const result = await searchLegislation(
      client as unknown as Parameters<typeof searchLegislation>[0],
      'legislation_provisions',
      'duties',
    )
    expect(result.hits.map((hit) => hit.id)).toEqual([provision.id])
  })
})
