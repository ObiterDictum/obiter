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

function completedTask(overrides: Record<string, unknown> = {}) {
  const task = {
    uid: 1,
    status: 'succeeded',
    details: {
      receivedDocuments: 1,
      indexedDocuments: 1,
    },
    error: null,
    ...overrides,
  }
  const promise = Promise.resolve({ taskUid: task.uid }) as Promise<{ taskUid: number }> & {
    waitTask(options?: { timeout?: number; interval?: number }): Promise<typeof task>
  }
  promise.waitTask = vi.fn(async () => task)
  return promise
}

describe('Atlas search client', () => {
  it('sets up the Atlas index shape', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
      updateFilterableAttributes: vi.fn(() => completedTask({ uid: 9 })),
      updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
      updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
      addDocuments: vi.fn(),
      search: vi.fn(),
    }
    const client = {
      createIndex: vi.fn(() => completedTask({ uid: 7 })),
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
      updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
      updateFilterableAttributes: vi.fn(() => completedTask({ uid: 9 })),
      updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
      updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
      addDocuments: vi.fn(),
      search: vi.fn(),
    }
    const client = {
      createIndex: vi.fn((): never => {
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

  it('fails index setup when a settings task fails after enqueue', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
      updateFilterableAttributes: vi.fn(() =>
        completedTask({
          uid: 9,
          status: 'failed',
          error: {
            code: 'invalid_settings_filterable_attributes',
            message: 'failed with sensitive detail',
          },
        }),
      ),
      updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
      updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
      addDocuments: vi.fn(),
      search: vi.fn(),
    }
    const client = {
      createIndex: vi.fn(() => completedTask({ uid: 7 })),
      index: vi.fn(() => index),
    }

    await expect(createIndex(client, 'atlas_authorities')).rejects.toThrow(
      'Atlas search index setup failed. Meilisearch task 9 failed (invalid_settings_filterable_attributes).',
    )
    await expect(createIndex(client, 'atlas_authorities')).rejects.not.toThrow(
      'sensitive detail',
    )
    expect(index.updateSortableAttributes).not.toHaveBeenCalled()
  })

  it('validates documents before indexing', async () => {
    const addDocuments = vi.fn(() => completedTask())
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'atlas_authorities', [authority()])

    expect(result).toEqual({ indexedCount: 1, failedCount: 0, errors: [] })
    expect(addDocuments).toHaveBeenCalledWith([authority()], { primaryKey: 'id' })
  })

  it('reports failed indexing tasks after enqueue', async () => {
    const addDocuments = vi.fn(() =>
      completedTask({
        uid: 9,
        status: 'failed',
        details: {
          receivedDocuments: 1,
          indexedDocuments: 0,
        },
        error: {
          code: 'invalid_document_id',
          message: 'failed with sensitive detail',
        },
      }),
    )
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'atlas_authorities', [authority()])

    expect(result).toEqual({
      indexedCount: 0,
      failedCount: 1,
      errors: [
        {
          recordId: null,
          message: 'Atlas indexing task 9 failed (invalid_document_id).',
        },
      ],
    })
    expect(result.errors[0]?.message).not.toContain('sensitive detail')
  })

  it('reports validation failures without touching Meilisearch', async () => {
    const addDocuments = vi.fn(() => completedTask())
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
    expect(result.hits[0]).not.toHaveProperty('paragraphs')
    expect(searchMock).toHaveBeenCalledWith('test', {
      filter: [
        'court = "uksc"',
        'jurisdiction = "england-and-wales"',
        'dateDecided >= "2024-01-01"',
        'dateDecided <= "2024-12-31"',
      ],
      sort: ['dateDecided:desc'],
      attributesToRetrieve: [
        'id',
        'title',
        'neutralCitation',
        'court',
        'jurisdiction',
        'dateDecided',
        'sourceType',
        'sourceUrl',
      ],
    })
  })

  it('escapes filter values as string literals', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: 'test',
      estimatedTotalHits: 1,
      processingTimeMs: 2,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    await search(client, 'atlas_authorities', 'test', {
      court: String.raw`uksc\" OR court = "bad`,
      jurisdiction: 'england-and-wales AND sourceType = "legislation"',
    })

    expect(searchMock).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({
        filter: [
          String.raw`court = "uksc\\\" OR court = \"bad"`,
          'jurisdiction = "england-and-wales AND sourceType = \\"legislation\\""',
        ],
      }),
    )
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
