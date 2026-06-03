import { describe, expect, it, vi } from 'vitest'
import {
  annotateLegalSearchHits,
  createIndex,
  extractLegalSearchSnippets,
  getDocument,
  indexDocuments,
  rankLegalSearchHitsByExactMatch,
  search,
} from './index'
import type { LegalSearchHit } from './index'

function authority(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uksc-2024-3',
    title: 'Potanina v Potanin',
    neutralCitation: '[2024] UKSC 3',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2024-01-31',
    sourceType: 'judgment' as const,
    sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
    paragraphs: [
      {
        id: 'uksc-2024-3-p1',
        documentId: 'uksc-2024-3',
        paragraphNumber: 1,
        text: 'The application for permission to bring proceedings under Part III is allowed.',
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
    expect(result.errors[0]?.recordId).toBe('uksc-2024-3')
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

    expect(result.hits[0]?.neutralCitation).toBe('[2024] UKSC 3')
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

  it('passes explicit result limits to the search provider', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: '',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    await search(client, 'legal_authorities', '', { court: 'uksc' }, { limit: 10 })

    expect(searchMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        filter: ['court = "uksc"'],
        limit: 10,
        sort: ['dateDecided:desc'],
      }),
    )
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
      id: 'ewca-civ-2026-659',
      title: 'Tinkler v Esken Ltd',
      neutralCitation: '[2026] EWCA Civ 659',
      court: 'ewca-civ',
      dateDecided: '2026-05-22',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/659',
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
    const idResult = await search(client, 'legal_authorities', 'ewca-civ-2026-659')

    expect(citationResult.hits.map((hit) => hit.id)).toEqual([
      'uksc-2024-3',
      'uksc-2026-99',
    ])
    expect(citationResult.hits[0]).toMatchObject({
      matchReason: 'exact_neutral_citation',
      retrievalPath: 'stored_lexical',
      rank: 1,
      score: 4,
    })
    expect(idResult.hits.map((hit) => hit.id)).toEqual([
      'ewca-civ-2026-659',
      'uksc-2026-99',
    ])
    expect(idResult.hits[0]).toMatchObject({
      matchReason: 'exact_document_id',
      retrievalPath: 'stored_lexical',
      rank: 1,
      score: 5,
    })
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

  it('ranks title matches ahead of provider hits that only match body text', () => {
    const bodyReferenceOnly = authority({
      id: 'd-33d1f5cf-b1d8-4437-8602-a9ae61baf7e5',
      title: 'Ferrucio Ferrara v Caroline Frances Ferrara',
      neutralCitation: '[2026] EWCA Civ 512',
      dateDecided: '2026-04-29',
    })
    const titleMatch = authority({
      id: 'd-f9e1d9a7-b267-4a57-9a63-bf9d6c955de3',
      title: 'Natalia Nikolaevna Potanina v Vladimir Olegovich Potanin',
      neutralCitation: '[2026] EWFC 80',
      court: 'ewfc',
      dateDecided: '2026-04-20',
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [bodyReferenceOnly, titleMatch] as LegalSearchHit[],
        'Potanina',
      ),
    ).toEqual([
      titleMatch,
      bodyReferenceOnly,
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

  it('extracts focused snippets from matching paragraphs', () => {
    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'This opening paragraph does not contain the party name.',
          },
          {
            id: 'uksc-2024-3-p2',
            documentId: 'uksc-2024-3',
            paragraphNumber: 2,
            text: 'The court considered Potanina and the effect of prior financial remedy proceedings.',
          },
        ],
      }),
      'Potanina financial',
    )

    expect(snippets).toEqual([
      {
        evidenceId: 'uksc-2024-3-p2',
        matchedTerms: ['potanina', 'financial'],
        paragraphNumber: 2,
        text: 'The court considered Potanina and the effect of prior financial remedy proceedings.',
      },
    ])
  })

  it('omits snippets when paragraph text does not match the query', () => {
    const snippets = extractLegalSearchSnippets(
      authority({
        title: 'Potanina v Potanin',
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'This paragraph explains a procedural point without the searched terms.',
          },
        ],
      }),
      'Potanina financial',
    )

    expect(snippets).toEqual([])
  })

  it('falls back to paragraphs with any matching query term and caps snippets at two', () => {
    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'Potanina appears in the first paragraph.',
          },
          {
            id: 'uksc-2024-3-p2',
            documentId: 'uksc-2024-3',
            paragraphNumber: 2,
            text: 'Financial remedy proceedings are discussed in the second paragraph.',
          },
          {
            id: 'uksc-2024-3-p3',
            documentId: 'uksc-2024-3',
            paragraphNumber: 3,
            text: 'A third Potanina reference should not exceed the result-card cap.',
          },
        ],
      }),
      'Potanina financial remedy',
    )

    expect(snippets).toEqual([
      {
        evidenceId: 'uksc-2024-3-p1',
        matchedTerms: ['potanina'],
        paragraphNumber: 1,
        text: 'Potanina appears in the first paragraph.',
      },
      {
        evidenceId: 'uksc-2024-3-p2',
        matchedTerms: ['financial', 'remedy'],
        paragraphNumber: 2,
        text: 'Financial remedy proceedings are discussed in the second paragraph.',
      },
    ])
  })

  it('returns snippets without paragraph arrays for result-list searches', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [
        authority({
          paragraphs: [
            {
              id: 'uksc-2024-3-p7',
              documentId: 'uksc-2024-3',
              paragraphNumber: 7,
              text: 'Potanina appears in this indexed paragraph.',
            },
          ],
        }),
      ],
      query: 'Potanina',
      estimatedTotalHits: 1,
      processingTimeMs: 2,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    const result = await search(client, 'legal_authorities', 'Potanina', {}, {
      includeSnippets: true,
    })

    expect(result.hits[0]).toMatchObject({
      id: 'uksc-2024-3',
      evidenceIds: ['uksc-2024-3-p7'],
      matchReason: 'title_contains_query',
      rank: 1,
      retrievalPath: 'stored_lexical',
      snippets: [
        {
          evidenceId: 'uksc-2024-3-p7',
          paragraphNumber: 7,
          text: 'Potanina appears in this indexed paragraph.',
        },
      ],
    })
    expect(result.hits[0]).not.toHaveProperty('paragraphs')
    expect(searchMock).toHaveBeenCalledWith(
      'Potanina',
      expect.objectContaining({
        attributesToRetrieve: expect.arrayContaining(['paragraphs']),
      }),
    )
  })

  it('annotates body-text matches with paragraph evidence metadata', () => {
    const [result] = annotateLegalSearchHits(
      [
        {
          ...authority({
            title: 'Unrelated title',
            paragraphs: undefined,
          }),
          snippets: [
            {
              evidenceId: 'uksc-2024-3-p7',
              paragraphNumber: 7,
              text: 'The court addressed financial remedy proceedings.',
              matchedTerms: ['financial', 'remedy'],
            },
          ],
        },
      ],
      'financial remedy',
    )

    expect(result).toMatchObject({
      evidenceIds: ['uksc-2024-3-p7'],
      matchReason: 'paragraph_terms_match',
      retrievalPath: 'stored_lexical',
      rank: 1,
      score: 0.5,
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

    const result = await getDocument(client, 'legal_authorities', 'uksc-2024-3')

    expect(result.paragraphs).toEqual(authority().paragraphs)
    expect(getDocumentMock).toHaveBeenCalledWith('uksc-2024-3')
  })
})
