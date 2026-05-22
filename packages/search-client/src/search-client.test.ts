import { describe, expect, it, vi } from 'vitest'
import { createIndex, indexDocuments, search } from './index'

function authority(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uksc-2024-1',
    title: 'R v Test',
    neutralCitation: '[2024] UKSC 1',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2024-01-17',
    sourceType: 'judgment',
    sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2024-001.html',
    paragraphs: [
      {
        id: 'uksc-2024-1-p1',
        documentId: 'uksc-2024-1',
        paragraphNumber: 1,
        text: 'The appeal is dismissed.',
      },
    ],
    ...overrides,
  }
}

describe('Atlas search client', () => {
  it('sets up the Atlas index shape', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(async () => ({})),
      updateFilterableAttributes: vi.fn(async () => ({})),
      updateSortableAttributes: vi.fn(async () => ({})),
      updateRankingRules: vi.fn(async () => ({})),
      addDocuments: vi.fn(),
      search: vi.fn(),
    }
    const client = {
      createIndex: vi.fn(async () => ({ taskUid: 7 })),
      index: vi.fn(() => index),
    }

    const result = await createIndex(client, 'atlas_authorities')

    expect(result.taskUid).toBe(7)
    expect(client.createIndex).toHaveBeenCalledWith('atlas_authorities', {
      primaryKey: 'id',
    })
    expect(index.updateSearchableAttributes).toHaveBeenCalledWith(
      expect.arrayContaining(['title', 'neutralCitation', 'paragraphs.text']),
    )
    expect(index.updateFilterableAttributes).toHaveBeenCalledWith(
      expect.arrayContaining(['court', 'jurisdiction', 'sourceType', 'dateDecided']),
    )
  })

  it('updates index settings when the index already exists', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(async () => ({})),
      updateFilterableAttributes: vi.fn(async () => ({})),
      updateSortableAttributes: vi.fn(async () => ({})),
      updateRankingRules: vi.fn(async () => ({})),
      addDocuments: vi.fn(),
      search: vi.fn(),
    }
    const client = {
      createIndex: vi.fn(async () => {
        throw Object.assign(new Error('already exists'), {
          code: 'index_already_exists',
        })
      }),
      index: vi.fn(() => index),
    }

    const result = await createIndex(client, 'atlas_authorities')

    expect(result.taskUid).toBeUndefined()
    expect(index.updateRankingRules).toHaveBeenCalled()
  })

  it('validates documents before indexing', async () => {
    const addDocuments = vi.fn(async () => ({}))
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'atlas_authorities', [authority()])

    expect(result).toEqual({ indexedCount: 1, failedCount: 0, errors: [] })
    expect(addDocuments).toHaveBeenCalledWith([authority()], { primaryKey: 'id' })
  })

  it('reports validation failures without touching Meilisearch', async () => {
    const addDocuments = vi.fn(async () => ({}))
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'atlas_authorities', [
      authority({ sourceUrl: 'not a url' }),
    ])

    expect(result.indexedCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.errors[0]?.recordId).toBe('uksc-2024-1')
    expect(addDocuments).not.toHaveBeenCalled()
  })

  it('returns typed search results and filter shape', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: 'test',
      estimatedTotalHits: 1,
      processingTimeMs: 2,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    const result = await search(client, 'atlas_authorities', 'test', {
      court: 'uksc',
      jurisdiction: 'england-and-wales',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
    })

    expect(result.hits[0]?.neutralCitation).toBe('[2024] UKSC 1')
    expect(searchMock).toHaveBeenCalledWith('test', {
      filter: [
        'court = "uksc"',
        'jurisdiction = "england-and-wales"',
        'dateDecided >= "2024-01-01"',
        'dateDecided <= "2024-12-31"',
      ],
      sort: ['dateDecided:desc'],
    })
  })

  it('wraps provider errors without leaking keys', async () => {
    const client = {
      index: () => ({
        search: async () => {
          throw new Error('failed with dev-key')
        },
      }),
    }

    await expect(search(client, 'atlas_authorities', 'test')).rejects.toThrow(
      'Atlas search failed. Search provider error: Error.',
    )
  })
})

