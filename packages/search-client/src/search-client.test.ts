import { describe, expect, it, vi } from 'vitest'
import { createIndex, getDocument, indexDocuments, rankLegalSearchHitsByExactMatch, search } from './index'
import type { LegalSearchHit } from './index'

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

describe('Legal search client', () => {
  it('sets up the search index shape', async () => {
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

    const result = await createIndex(client, 'legal_authorities')

    expect(result.taskUid).toBe(7)
    expect(client.createIndex).toHaveBeenCalledWith('legal_authorities', {
      primaryKey: 'id',
    })
    expect(index.updateSearchableAttributes).toHaveBeenCalledWith(
      expect.arrayContaining(['id', 'title', 'neutralCitation', 'paragraphs.text']),
    )
    expect(index.updateFilterableAttributes).toHaveBeenCalledWith(
      expect.arrayContaining(['court', 'jurisdiction', 'sourceType', 'dateDecided']),
    )
    expect(index.updateRankingRules).toHaveBeenCalledWith([
      'words',
      'typo',
      'proximity',
      'attribute',
      'exactness',
      'sort',
    ])
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

    const result = await createIndex(client, 'legal_authorities')

    expect(result.taskUid).toBeUndefined()
    expect(index.updateRankingRules).toHaveBeenCalled()
  })

  it('updates index settings for the real Meilisearch existing-index error shape', async () => {
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
          name: 'MeiliSearchApiError',
          cause: {
            code: 'index_already_exists',
            message: 'Index already exists.',
          },
        })
      }),
      index: vi.fn(() => index),
    }

    const result = await createIndex(client, 'legal_authorities')

    expect(result.taskUid).toBeUndefined()
    expect(index.updateSearchableAttributes).toHaveBeenCalled()
    expect(index.updateFilterableAttributes).toHaveBeenCalled()
    expect(index.updateSortableAttributes).toHaveBeenCalled()
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

    await expect(createIndex(client, 'legal_authorities')).rejects.toThrow(
      'Search index setup failed. Meilisearch task 9 failed (invalid_settings_filterable_attributes).',
    )
    await expect(createIndex(client, 'legal_authorities')).rejects.not.toThrow(
      'sensitive detail',
    )
    expect(index.updateSortableAttributes).not.toHaveBeenCalled()
  })

  it('validates documents before indexing', async () => {
    const addDocuments = vi.fn(() => completedTask())
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'legal_authorities', [authority()])

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

    const result = await indexDocuments(client, 'legal_authorities', [authority()])

    expect(result).toEqual({
      indexedCount: 0,
      failedCount: 1,
      errors: [
        {
          recordId: null,
          message: 'Indexing task 9 failed (invalid_document_id).',
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

    const result = await indexDocuments(client, 'legal_authorities', [
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

    const result = await search(client, 'legal_authorities', 'test', {
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

  it('promotes exact citation and identifier matches before newer partial hits', async () => {
    const newerPartial = authority({
      id: 'uksc-2026-99',
      title: 'Potanina update',
      neutralCitation: '[2026] UKSC 99',
      dateDecided: '2026-01-01',
    })
    const exactCitation = authority({
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      dateDecided: '2024-01-31',
    })
    const exactIdentifier = authority({
      id: 'ewca-civ-2025-7',
      title: 'Example v Test',
      neutralCitation: '[2025] EWCA Civ 7',
      dateDecided: '2025-02-01',
    })
    const searchMock = vi
      .fn()
      .mockResolvedValueOnce({
        hits: [newerPartial, exactCitation],
        query: '[2024] UKSC 3',
        estimatedTotalHits: 2,
        processingTimeMs: 2,
      })
      .mockResolvedValueOnce({
        hits: [newerPartial, exactIdentifier],
        query: 'ewca-civ-2025-7',
        estimatedTotalHits: 2,
        processingTimeMs: 2,
      })
    const client = {
      index: () => ({ search: searchMock }),
    }

    const citationResult = await search(client, 'legal_authorities', '[2024] UKSC 3')
    const idResult = await search(client, 'legal_authorities', 'ewca-civ-2025-7')

    expect(citationResult.hits.map((hit) => hit.id)).toEqual([
      'uksc-2024-3',
      'uksc-2026-99',
    ])
    expect(idResult.hits.map((hit) => hit.id)).toEqual([
      'ewca-civ-2025-7',
      'uksc-2026-99',
    ])
  })

  it('ranks hits without neutral citations without throwing', () => {
    const withoutCitation = authority({
      id: 'd-dd848612-73c3-4719-b18f-5643e51dcb17',
      title: 'NHS England v Justin Yung Hui Chin',
      neutralCitation: null,
      court: 'ftt-phl',
      dateDecided: '2026-02-26',
    })
    const withCitation = authority({
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      dateDecided: '2024-01-31',
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [withoutCitation, withCitation] as LegalSearchHit[],
        '[2024] UKSC 3',
      ),
    ).toEqual([
      withCitation,
      withoutCitation,
    ])
  })

  it('can retrieve paragraphs for fetch-on-miss cached results', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: 'test',
      estimatedTotalHits: 1,
      processingTimeMs: 2,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    const result = await search(client, 'legal_authorities', 'test', {}, {
      includeParagraphs: true,
    })

    expect(result.hits[0]?.paragraphs).toEqual(authority().paragraphs)
    expect(searchMock).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({
        attributesToRetrieve: expect.arrayContaining(['paragraphs']),
      }),
    )
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

    await search(client, 'legal_authorities', 'test', {
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

    await expect(search(client, 'legal_authorities', 'test')).rejects.toThrow(
      'Search failed. Search provider error: Error.',
    )
  })

  it('retrieves a stored legal document by id', async () => {
    const getDocumentMock = vi.fn(async () => authority())
    const client = {
      index: () => ({ getDocument: getDocumentMock }),
    }

    const result = await getDocument(client, 'legal_authorities', 'uksc-2024-1')

    expect(result.paragraphs).toEqual(authority().paragraphs)
    expect(getDocumentMock).toHaveBeenCalledWith('uksc-2024-1')
  })
})
