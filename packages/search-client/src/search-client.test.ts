import { describe, expect, it, vi } from 'vitest'
import {
  containsEveryQueryTerm,
  containsEverySearchableQueryTerm,
  createIndex,
  exactMatchPunctuationFolds,
  exactMatchPunctuationFrom,
  exactMatchPunctuationTo,
  extractLegalSearchSnippets,
  getDocument,
  getIndexStatus,
  indexDocuments,
  legalSearchIndexSettings,
  normalizeCitationValue,
  normalizeExactMatchValue,
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
  const promise = Promise.resolve({ taskUid: task.uid }) as Promise<{
    taskUid: number
  }> & {
    waitTask(options?: {
      timeout?: number
      interval?: number
    }): Promise<typeof task>
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
      updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
      getPrefixSearch: vi.fn(async () => 'disabled'),
      updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
      updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
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
    expect(index.updateSearchableAttributes).toHaveBeenCalledWith([
      'id',
      'title',
      'neutralCitation',
      'paragraphs.text',
    ])
    expect(index.updateFilterableAttributes).toHaveBeenCalledWith([
      'court',
      'jurisdiction',
      'sourceType',
      'dateDecided',
      'dateDecidedTimestamp',
    ])
    expect(index.updateRankingRules).toHaveBeenCalledWith([
      'words',
      'typo',
      'proximity',
      'attribute',
      'exactness',
      'sort',
    ])
    expect(index.updatePrefixSearch).toHaveBeenCalledWith('disabled')
    expect(
      index.updatePrefixSearch.mock.results[0]?.value.waitTask,
    ).toHaveBeenCalledWith({ timeout: 600_000, interval: 100 })
    expect(index.updateStopWords).toHaveBeenCalledWith([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'been',
      'by',
      'for',
      'from',
      'in',
      'is',
      'it',
      'of',
      'on',
      'or',
      'that',
      'the',
      'this',
      'to',
      'was',
      'were',
      'with',
    ])
    expect(index.updateTypoTolerance).toHaveBeenCalledWith({
      minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
    })
  })

  /**
   * Meilisearch added `prefixSearch` in 1.12. A 1.8 server has no
   * `settings/prefix-search` route and answers 404, so an index it configures
   * still has prefix search on. That is a different search configuration from
   * the one this package defines, not a cosmetic gap, and the benchmark floor
   * `minimumShortWordPrecision` rests on prefix search being off.
   */
  describe('a server that cannot apply an index setting', () => {
    function unsupportedPrefixSearch() {
      const error = new Error('404: Not Found')
      Object.assign(error, { response: new Response(null, { status: 404 }) })
      return () => {
        throw error
      }
    }

    function indexWithout404PrefixSearch() {
      return {
        updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
        updateFilterableAttributes: vi.fn(() => completedTask({ uid: 9 })),
        updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
        updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
        updatePrefixSearch: vi.fn(unsupportedPrefixSearch()),
        getPrefixSearch: vi.fn(unsupportedPrefixSearch()),
        updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
        updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
        addDocuments: vi.fn(),
        search: vi.fn(),
      }
    }

    function clientFor(index: ReturnType<typeof indexWithout404PrefixSearch>) {
      return {
        createIndex: vi.fn(() => completedTask({ uid: 7 })),
        index: vi.fn(() => index),
      }
    }

    // The default. A caller that has not said it can live with a missing
    // setting is told, rather than served an index it did not ask for.
    it('fails by default rather than configuring a different index', async () => {
      const index = indexWithout404PrefixSearch()

      await expect(
        createIndex(clientFor(index), 'legal_authorities'),
      ).rejects.toThrow(/Search index setup failed/)
    })

    it('continues when the caller opts in, and names what it could not apply', async () => {
      const index = indexWithout404PrefixSearch()

      const result = await createIndex(clientFor(index), 'legal_authorities', {
        allowUnsupportedSettings: true,
      })

      expect(result.unsupportedSettings).toEqual(['prefixSearch'])
      // Everything after the unsupported setting still has to be applied.
      expect(index.updateStopWords).toHaveBeenCalled()
      expect(index.updateTypoTolerance).toHaveBeenCalled()
    })

    /**
     * The reason support is established by reading. Writing to a settings route
     * Meilisearch 1.8.3 does not have returns 404 and then wedges the index:
     * measured with curl, a stop-words write succeeds 5 of 5 on its own and
     * times out 4 of 5 when it follows a write to the absent prefix-search
     * route. Catching the 404 is not enough — issuing it is what does the
     * damage, and it lands on whatever request comes next.
     */
    it('never issues the write for a setting the server does not have', async () => {
      const index = indexWithout404PrefixSearch()

      await createIndex(clientFor(index), 'legal_authorities', {
        allowUnsupportedSettings: true,
      })

      expect(index.getPrefixSearch).toHaveBeenCalled()
      expect(index.updatePrefixSearch).not.toHaveBeenCalled()
    })

    it('reports nothing unsupported when every setting applies', async () => {
      const index = {
        ...indexWithout404PrefixSearch(),
        updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
        getPrefixSearch: vi.fn(async () => 'disabled'),
      }

      const result = await createIndex(clientFor(index), 'legal_authorities', {
        allowUnsupportedSettings: true,
      })

      expect(result.unsupportedSettings).toEqual([])
    })

    // A 400 means the value was wrong, which is a bug here. Opting in to old
    // servers must not turn a real error into a skipped setting. The probe
    // succeeds, so the route exists and the write is genuinely at fault.
    it('still fails on a rejected value, not only a missing route', async () => {
      const index = indexWithout404PrefixSearch()
      const badRequest = new Error('400: Bad Request')
      Object.assign(badRequest, {
        response: new Response(null, { status: 400 }),
      })
      index.getPrefixSearch = vi.fn(async () => 'disabled')
      index.updatePrefixSearch = vi.fn(() => {
        throw badRequest
      })

      await expect(
        createIndex(clientFor(index), 'legal_authorities', {
          allowUnsupportedSettings: true,
        }),
      ).rejects.toThrow(/Search index setup failed/)
    })
  })

  // The benchmark report embeds legalSearchIndexSettings as its record of the
  // configuration under test, so it is only trustworthy while these values are
  // the ones createIndex and search actually apply.
  it('reports the index settings it applies', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
      updateFilterableAttributes: vi.fn(() => completedTask({ uid: 9 })),
      updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
      updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
      updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
      getPrefixSearch: vi.fn(async () => 'disabled'),
      updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
      updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
      addDocuments: vi.fn(),
      search: vi.fn(async () => ({ hits: [] })),
    }
    const client = {
      createIndex: vi.fn(() => completedTask({ uid: 7 })),
      index: vi.fn(() => index),
    }

    await createIndex(client, 'legal_authorities')
    await search(client, 'legal_authorities', 'permission to appeal')

    expect(index.updateTypoTolerance).toHaveBeenCalledWith({
      minWordSizeForTypos: legalSearchIndexSettings.minWordSizeForTypos,
    })
    expect(index.updatePrefixSearch).toHaveBeenCalledWith(
      legalSearchIndexSettings.prefixSearch,
    )
    expect(index.updateStopWords).toHaveBeenCalledWith(
      expect.objectContaining({
        length: legalSearchIndexSettings.stopWordCount,
      }),
    )
    expect(index.search).toHaveBeenCalledWith(
      'permission to appeal',
      expect.objectContaining({
        matchingStrategy: legalSearchIndexSettings.matchingStrategy,
        rankingScoreThreshold: legalSearchIndexSettings.rankingScoreThreshold,
      }),
    )
  })

  it('updates index settings when the index already exists', async () => {
    const index = {
      updateSearchableAttributes: vi.fn(() => completedTask({ uid: 8 })),
      updateFilterableAttributes: vi.fn(() => completedTask({ uid: 9 })),
      updateSortableAttributes: vi.fn(() => completedTask({ uid: 10 })),
      updateRankingRules: vi.fn(() => completedTask({ uid: 11 })),
      updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
      getPrefixSearch: vi.fn(async () => 'disabled'),
      updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
      updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
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
      updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
      getPrefixSearch: vi.fn(async () => 'disabled'),
      updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
      updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
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
      updatePrefixSearch: vi.fn(() => completedTask({ uid: 12 })),
      getPrefixSearch: vi.fn(async () => 'disabled'),
      updateStopWords: vi.fn(() => completedTask({ uid: 13 })),
      updateTypoTolerance: vi.fn(() => completedTask({ uid: 14 })),
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
    const indexingTask = completedTask()
    const addDocuments = vi.fn(() => indexingTask)
    const client = {
      index: () => ({ addDocuments }),
    }

    const result = await indexDocuments(client, 'legal_authorities', [
      authority(),
    ])

    expect(result).toEqual({ indexedCount: 1, failedCount: 0, errors: [] })
    // The engine receives the document plus the derived numeric date. The
    // domain document itself is unchanged; the field exists only in the index,
    // so that range filters have a numeric operand to compare against.
    expect(addDocuments).toHaveBeenCalledWith(
      [{ ...authority(), dateDecidedTimestamp: Date.UTC(2024, 0, 31) }],
      { primaryKey: 'id' },
    )
    expect(indexingTask.waitTask).toHaveBeenCalledWith({
      timeout: 1_800_000,
      interval: 100,
    })
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

    const result = await indexDocuments(client, 'legal_authorities', [
      authority(),
    ])

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

  it('reports an indexing wait timeout without claiming the task failed', async () => {
    const indexingTask = completedTask()
    indexingTask.waitTask = vi.fn(async () => {
      throw new Error('Task timed out after 1800000ms')
    })
    const client = {
      index: () => ({ addDocuments: vi.fn(() => indexingTask) }),
    }

    await expect(
      indexDocuments(client, 'legal_authorities', [authority()]),
    ).rejects.toThrow(
      'Document indexing status timed out. The Meilisearch task may still be running.',
    )
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

  it('rejects a malformed date bound instead of widening the search', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [],
      query: 'test',
      estimatedTotalHits: 0,
      processingTimeMs: 1,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    // Dropping an unparseable bound would return judgments outside the
    // requested range as though they belonged in it, which is a wrong answer
    // rather than a missing one.
    await expect(
      search(client, 'legal_authorities', 'test', { dateFrom: '01/01/2024' }),
    ).rejects.toThrow(/dateFrom must be an ISO date/)
    expect(searchMock).not.toHaveBeenCalled()
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
        // Numeric operands. Meilisearch comparison operators reject a quoted
        // date string, which is what made the three date benchmark cases error.
        `dateDecidedTimestamp >= ${Date.UTC(2024, 0, 1)}`,
        `dateDecidedTimestamp <= ${Date.UTC(2024, 11, 31)}`,
      ],
      sort: ['dateDecided:desc'],
      matchingStrategy: 'all',
      rankingScoreThreshold: 0.25,
      showRankingScore: true,
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

  it('allows callers to lower or disable the ranking-score threshold', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: 'test',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    await search(
      client,
      'legal_authorities',
      'test',
      {},
      { rankingScoreThreshold: 0.2 },
    )
    await search(
      client,
      'legal_authorities',
      'test',
      {},
      { rankingScoreThreshold: null },
    )

    expect(searchMock).toHaveBeenNthCalledWith(
      1,
      'test',
      expect.objectContaining({ rankingScoreThreshold: 0.2 }),
    )
    expect(searchMock).toHaveBeenNthCalledWith(
      2,
      'test',
      expect.not.objectContaining({ rankingScoreThreshold: expect.anything() }),
    )
  })

  it('allows callers to relax all-term matching', async () => {
    const searchMock = vi.fn(async () => ({
      hits: [authority()],
      query: 'test',
      estimatedTotalHits: 1,
      processingTimeMs: 1,
    }))
    const client = {
      index: () => ({ search: searchMock }),
    }

    await search(
      client,
      'legal_authorities',
      'test',
      {},
      { matchingStrategy: 'frequency' },
    )

    expect(searchMock).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ matchingStrategy: 'frequency' }),
    )
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

    await search(
      client,
      'legal_authorities',
      '',
      { court: 'uksc' },
      { limit: 10 },
    )

    expect(searchMock).toHaveBeenCalledWith(
      '',
      expect.not.objectContaining({
        rankingScoreThreshold: expect.anything(),
      }),
    )
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
      _rankingScore: 0.99,
    })
    const exactCitation = authority({
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      dateDecided: '2024-01-31',
      _rankingScore: 0.1,
    })
    const exactIdentifier = authority({
      id: 'ewca-civ-2026-659',
      title: 'Tinkler v Esken Ltd',
      neutralCitation: '[2026] EWCA Civ 659',
      court: 'ewca-civ',
      dateDecided: '2026-05-22',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/659',
      _rankingScore: 0.05,
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

    const citationResult = await search(
      client,
      'legal_authorities',
      '[2024] UKSC 3',
    )
    const idResult = await search(
      client,
      'legal_authorities',
      'ewca-civ-2026-659',
    )

    expect(citationResult.hits.map((hit) => hit.id)).toEqual([
      'uksc-2024-3',
      'uksc-2026-99',
    ])
    expect(idResult.hits.map((hit) => hit.id)).toEqual([
      'ewca-civ-2026-659',
      'uksc-2026-99',
    ])
  })

  it('uses the engine score ahead of recency within a legal match tier', async () => {
    // Raw provider field, exercises readEngineRankingScore through search().
    const newerLowerScore = authority({
      id: 'benchmark-newer',
      title: 'Alpha v Beta',
      neutralCitation: '[2025] EWHC 1 (KB)',
      dateDecided: '2025-01-01',
      paragraphs: [
        {
          id: 'benchmark-newer-p1',
          documentId: 'benchmark-newer',
          paragraphNumber: 1,
          text: 'The duty was considered in context.',
        },
      ],
      _rankingScore: 0.2,
    })
    const olderHigherScore = authority({
      id: 'benchmark-older',
      title: 'Gamma v Delta',
      neutralCitation: '[2020] EWHC 2 (KB)',
      dateDecided: '2020-01-01',
      paragraphs: [
        {
          id: 'benchmark-older-p1',
          documentId: 'benchmark-older',
          paragraphNumber: 1,
          text: 'The duty was considered in context.',
        },
      ],
      _rankingScore: 0.9,
    })
    const searchMock = vi.fn(async () => ({
      hits: [newerLowerScore, olderHigherScore],
      query: 'duty',
      estimatedTotalHits: 2,
      processingTimeMs: 1,
    }))
    const client = { index: () => ({ search: searchMock }) }

    const result = await search(
      client,
      'legal_authorities',
      'duty',
      {},
      { includeSnippets: true },
    )

    expect(result.hits.map(({ id }) => id)).toEqual([
      'benchmark-older',
      'benchmark-newer',
    ])
    expect(
      result.hits.map(({ engineRankingScore }) => engineRankingScore),
    ).toEqual([0.9, 0.2])
  })

  it('ignores invalid raw engine ranking scores', async () => {
    const invalidScores = [1.5, Number.NaN, -0.1, '0.5']
    const searchMock = vi.fn(async () => ({
      hits: invalidScores.map((rankingScore, index) =>
        authority({
          id: `invalid-score-${index}`,
          _rankingScore: rankingScore,
        }),
      ),
      query: 'Potanina',
      estimatedTotalHits: invalidScores.length,
      processingTimeMs: 1,
    }))
    const client = { index: () => ({ search: searchMock }) }

    const result = await search(client, 'legal_authorities', 'Potanina')

    expect(
      result.hits.map(({ engineRankingScore }) => engineRankingScore),
    ).toEqual([undefined, undefined, undefined, undefined])
  })

  it('orders phrase, all-term, and any-term body matches before recency', () => {
    // Post-parse field, exercises the ranker in isolation.
    const anyTerm = authority({
      id: 'benchmark-any',
      title: 'Any v Term',
      dateDecided: '2025-01-01',
      engineRankingScore: 1,
      paragraphs: [
        {
          id: 'benchmark-any-p1',
          documentId: 'benchmark-any',
          paragraphNumber: 1,
          text: 'The material was reviewed.',
        },
      ],
    })
    const allTerms = authority({
      id: 'benchmark-all',
      title: 'All v Terms',
      dateDecided: '2024-01-01',
      engineRankingScore: 0.9,
      paragraphs: [
        {
          id: 'benchmark-all-p1',
          documentId: 'benchmark-all',
          paragraphNumber: 1,
          text: 'The material made a measurable contribution.',
        },
      ],
    })
    const phrase = authority({
      id: 'benchmark-phrase',
      title: 'Phrase v Match',
      dateDecided: '2020-01-01',
      engineRankingScore: 0.1,
      paragraphs: [
        {
          id: 'benchmark-phrase-p1',
          documentId: 'benchmark-phrase',
          paragraphNumber: 1,
          text: 'The court considered material contribution directly.',
        },
      ],
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [anyTerm, allTerms, phrase] as LegalSearchHit[],
        'material contribution',
      ).map(({ id }) => id),
    ).toEqual(['benchmark-phrase', 'benchmark-all', 'benchmark-any'])
  })

  it('uses snippets when paragraphs are present but empty for body matching', () => {
    const snippetPhrase = authority({
      id: 'snippet-phrase',
      title: 'Snippet v Phrase',
      dateDecided: '2020-01-01',
      engineRankingScore: 0.1,
      paragraphs: [],
      snippets: [
        {
          evidenceId: 'snippet-phrase:judgment_paragraph:1',
          paragraphNumber: 1,
          text: 'The court considered material contribution directly.',
          matchedTerms: ['material contribution'],
          matchReason: 'body_text_match' as const,
        },
      ],
    })
    const allTerms = authority({
      id: 'paragraph-all-terms',
      title: 'Paragraph v Terms',
      dateDecided: '2025-01-01',
      engineRankingScore: 1,
      paragraphs: [
        {
          id: 'paragraph-all-terms-p1',
          documentId: 'paragraph-all-terms',
          paragraphNumber: 1,
          text: 'The material made a measurable contribution.',
        },
      ],
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [snippetPhrase, allTerms],
        'material contribution',
      ).map(({ id }) => id),
    ).toEqual(['snippet-phrase', 'paragraph-all-terms'])
  })

  it('does not read a missing dateDecided when caller order is preserved', () => {
    const withoutDateDecided = authority({
      id: 'undated',
      title: 'Undated v Authority',
      engineRankingScore: 0.7,
    })
    Reflect.deleteProperty(withoutDateDecided, 'dateDecided')
    const dated = authority({
      id: 'dated',
      title: 'Dated v Authority',
      dateDecided: '2020-01-01',
      engineRankingScore: 0.7,
    })

    expect(() =>
      rankLegalSearchHitsByExactMatch([withoutDateDecided, dated], 'unmatched'),
    ).not.toThrow()
    expect(
      rankLegalSearchHitsByExactMatch(
        [withoutDateDecided, dated],
        'unmatched',
      ).map(({ id }) => id),
    ).toEqual(['undated', 'dated'])
  })

  it('preserves caller order when match tier and engine score are tied', () => {
    const older = authority({
      id: 'benchmark-tie-older',
      title: 'Older v Authority',
      dateDecided: '2020-01-01',
      engineRankingScore: 0.7,
    })
    const newer = authority({
      id: 'benchmark-tie-newer',
      title: 'Newer v Authority',
      dateDecided: '2025-01-01',
      engineRankingScore: 0.7,
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [older, newer] as LegalSearchHit[],
        'unmatched',
      ).map(({ id }) => id),
    ).toEqual(['benchmark-tie-older', 'benchmark-tie-newer'])
  })

  it('ranks a title phrase ahead of a title containing scattered query terms', () => {
    const scatteredTerms = authority({
      id: 'scattered-title-terms',
      title: 'Material v Contribution',
      dateDecided: '2025-01-01',
      engineRankingScore: 0.7,
    })
    const phrase = authority({
      id: 'title-phrase',
      title: 'Material Contribution Ltd',
      dateDecided: '2020-01-01',
      engineRankingScore: 0.7,
    })

    expect(
      rankLegalSearchHitsByExactMatch(
        [scatteredTerms, phrase],
        'material contribution',
      ).map(({ id }) => id),
    ).toEqual(['title-phrase', 'scattered-title-terms'])
  })

  it('preserves supplied order for plain authorities without engine scores', () => {
    const older = authority({
      id: 'plain-older',
      title: 'Older v Authority',
      dateDecided: '2020-01-01',
      paragraphs: [
        {
          id: 'plain-older-p1',
          documentId: 'plain-older',
          paragraphNumber: 1,
          text: 'The material was considered.',
        },
      ],
    })
    const newer = authority({
      id: 'plain-newer',
      title: 'Newer v Authority',
      dateDecided: '2025-01-01',
      paragraphs: [
        {
          id: 'plain-newer-p1',
          documentId: 'plain-newer',
          paragraphNumber: 1,
          text: 'The material was considered.',
        },
      ],
    })

    expect(
      rankLegalSearchHitsByExactMatch([older, newer], 'material').map(
        ({ id }) => id,
      ),
    ).toEqual(['plain-older', 'plain-newer'])
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
    ).toEqual([withCitation, withoutCitation])
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
    ).toEqual([titleMatch, bodyReferenceOnly])
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

    const result = await search(
      client,
      'legal_authorities',
      'test',
      {},
      {
        includeParagraphs: true,
      },
    )

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
        evidenceId: 'uksc-2024-3:judgment_paragraph:2',
        matchedTerms: ['potanina', 'financial'],
        matchReason: 'body_text_match',
        paragraphNumber: 2,
        text: 'The court considered Potanina and the effect of prior financial remedy proceedings.',
      },
    ])
  })

  it('does not select snippets from single-character query tokens', () => {
    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'A court considered the application.',
          },
        ],
      }),
      'Re A',
    )

    expect(snippets).toEqual([])
  })

  it('matches snippets on Unicode-aware word boundaries', () => {
    const hit = authority({
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: "A test was applied to José's self-incrimination evidence and the testator's intention.",
        },
        {
          id: 'uksc-2024-3-p2',
          documentId: 'uksc-2024-3',
          paragraphNumber: 2,
          text: 'Contested testimony from Joséphine concerned intestate protest and the latest filing.',
        },
      ],
    })

    expect(extractLegalSearchSnippets(hit, 'test')).toMatchObject([
      { paragraphNumber: 1, matchedTerms: ['test'] },
    ])
    expect(extractLegalSearchSnippets(hit, 'testator')).toMatchObject([
      { paragraphNumber: 1, matchedTerms: ['testator'] },
    ])
    expect(extractLegalSearchSnippets(hit, 'incrimination')).toMatchObject([
      { paragraphNumber: 1, matchedTerms: ['incrimination'] },
    ])
    expect(extractLegalSearchSnippets(hit, 'José')).toMatchObject([
      { paragraphNumber: 1, matchedTerms: ['josé'] },
    ])
    expect(extractLegalSearchSnippets(hit, 'Joséphine')).toMatchObject([
      { paragraphNumber: 2, matchedTerms: ['joséphine'] },
    ])
    expect(containsEveryQueryTerm('Joséphine contested', 'José test')).toBe(
      false,
    )
    expect(containsEverySearchableQueryTerm('test_case', 'test')).toBe(false)
    expect(containsEverySearchableQueryTerm('_test', 'test')).toBe(false)
    expect(
      containsEverySearchableQueryTerm('The test was applied.', 'the test'),
    ).toBe(true)
    expect(
      containsEverySearchableQueryTerm('The test was applied.', 'the'),
    ).toBe(false)
  })

  it('normalizes raw and display snippet text equivalently', () => {
    const rawText = '  The\n\ttestator’s   intention was\n recorded.  '
    const displayText = rawText.replace(/\s+/g, ' ').trim()

    expect(normalizeExactMatchValue(rawText)).toBe(
      normalizeExactMatchValue(displayText),
    )
  })

  it('derives equal-length SQL punctuation translation arguments', () => {
    const fromCharacters = Array.from(exactMatchPunctuationFrom)
    const toCharacters = Array.from(exactMatchPunctuationTo)

    expect(fromCharacters).toHaveLength(toCharacters.length)
    expect(
      fromCharacters.map((from, index) => [from, toCharacters[index]]),
    ).toEqual(exactMatchPunctuationFolds)
  })

  it('folds typographic apostrophes before whole-term matching', () => {
    expect(
      containsEveryQueryTerm(
        'The testator’s intention was recorded.',
        "testator's",
      ),
    ).toBe(true)
    expect(
      containsEveryQueryTerm(
        "The testator's intention was recorded.",
        'testator’s',
      ),
    ).toBe(true)

    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'The testator’s intention was recorded.',
          },
        ],
      }),
      "testator's",
    )

    expect(snippets).toHaveLength(1)
    expect(snippets[0]?.matchedTerms).toEqual(["testator's"])

    const longSnippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: `${'Introduction. '.repeat(25)}The testator’s intention was recorded.`,
          },
        ],
      }),
      "testator's",
    )

    expect(longSnippets[0]?.text).toContain('testator’s intention')
  })

  it('maps snippet offsets when normalization changes text length', () => {
    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: `${'İ '.repeat(150)}The test was applied to the evidence.${' Further discussion followed.'.repeat(10)}`,
          },
        ],
      }),
      'test',
    )

    expect(snippets[0]?.text).toContain('The test was applied')
  })

  it('keeps aligned non-ASCII prefixes on the direct snippet path', () => {
    const matchPrefix = `The claimant’s evidence was considered. ${'Further evidence was considered. '.repeat(10)}`
    const text = `${matchPrefix}test was applied.${' Further evidence was considered.'.repeat(10)}`

    expect(normalizeExactMatchValue(matchPrefix)).toHaveLength(
      matchPrefix.length - 1,
    )
    expect(normalizeExactMatchValue(`${matchPrefix}x`).length - 1).toBe(
      matchPrefix.length,
    )

    const [snippet] = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text,
          },
        ],
      }),
      'test',
    )

    expect(snippet?.text).toContain('test was applied')
  })

  it('maps snippet offsets when normalization shifts cancel overall', () => {
    const decomposedAccent = '\u0065\u0301'
    const ligature = '\uFB01 '
    expect(decomposedAccent).toHaveLength(2)
    expect(normalizeExactMatchValue(decomposedAccent)).toHaveLength(1)

    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: `${`${decomposedAccent} `.repeat(200)}The test was applied. ${ligature.repeat(200)}`,
          },
        ],
      }),
      'test',
    )

    expect(snippets[0]?.text).toContain('The test was applied')
  })

  it('treats citation punctuation as literal whole-term text', () => {
    const citation = '[2021] EWHC 123 (Admin)'
    const hit = authority({
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: `The court followed ${citation}.`,
        },
      ],
    })

    expect(containsEveryQueryTerm(hit.paragraphs[0].text, citation)).toBe(true)
    expect(extractLegalSearchSnippets(hit, citation)).toHaveLength(1)
    expect(
      containsEveryQueryTerm(
        'The court followed 2024 UKSC 3.',
        '[2024] UKSC 3',
      ),
    ).toBe(false)
    expect(extractLegalSearchSnippets(hit, '[2024] UKSC 3')).toEqual([])
  })

  it('reuses compiled term patterns without leaking match state', () => {
    // The pattern cache is keyed by term, so the same term must keep giving an
    // independent answer for each value it is tested against.
    expect(containsEveryQueryTerm('the testator intended', 'testator')).toBe(
      true,
    )
    expect(containsEveryQueryTerm('the testimony was heard', 'testator')).toBe(
      false,
    )
    expect(containsEveryQueryTerm('the testator intended', 'testator')).toBe(
      true,
    )
    expect(containsEveryQueryTerm('self-incrimination applies', 'self')).toBe(
      true,
    )
    expect(containsEveryQueryTerm('selfless conduct', 'self')).toBe(false)

    // Metacharacter terms are escaped before compiling but cached under the raw
    // key, so the cache must keep near-identical citations distinct.
    expect(
      containsEveryQueryTerm('cited as [2024] uksc 3 today', '[2024] UKSC 3'),
    ).toBe(true)
    expect(
      containsEveryQueryTerm('cited as [2024] uksc 33 today', '[2024] UKSC 3'),
    ).toBe(false)
  })

  it('excerpts snippets from the raw paragraph text', () => {
    // Matching runs on normalized text, but the returned excerpt must come from
    // the original so casing and punctuation survive.
    const snippets = extractLegalSearchSnippets(
      authority({
        paragraphs: [
          {
            id: 'uksc-2024-3-p1',
            documentId: 'uksc-2024-3',
            paragraphNumber: 1,
            text: 'The Testator INTENDED to revoke the earlier will.',
          },
        ],
      }),
      'testator',
    )

    expect(snippets).toHaveLength(1)
    expect(snippets[0]?.text).toBe(
      'The Testator INTENDED to revoke the earlier will.',
    )
    expect(snippets[0]?.matchedTerms).toEqual(['testator'])
  })

  it('centres a trimmed snippet on a whole-term match', () => {
    const filler = 'The parties exchanged correspondence over many months. '
    const hit = authority({
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: `Contested testimony opened the hearing. ${filler.repeat(6)}The test was then applied.`,
        },
      ],
    })

    const [snippet] = extractLegalSearchSnippets(hit, 'test')

    // "testimony" appears first, but it is not a whole-term match, so the
    // excerpt window must land on "The test was then applied".
    expect(snippet?.text).toContain('The test was then applied')
    expect(snippet?.matchedTerms).toEqual(['test'])
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
        evidenceId: 'uksc-2024-3:judgment_paragraph:1',
        matchedTerms: ['potanina'],
        matchReason: 'body_text_match',
        paragraphNumber: 1,
        text: 'Potanina appears in the first paragraph.',
      },
      {
        evidenceId: 'uksc-2024-3:judgment_paragraph:2',
        matchedTerms: ['financial', 'remedy'],
        matchReason: 'body_text_match',
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

    const result = await search(
      client,
      'legal_authorities',
      'Potanina',
      {},
      {
        includeSnippets: true,
      },
    )

    expect(result.hits[0]).toMatchObject({
      id: 'uksc-2024-3',
      snippets: [
        {
          // Position in the document, not the number the judgment prints.
          // The fixture's only matching paragraph is the first one retained.
          evidenceId: 'uksc-2024-3:judgment_paragraph:1',
          matchReason: 'body_text_match',
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
    const providerError = new Error('failed with dev-key')
    const client = {
      index: () => ({
        search: async () => {
          throw providerError
        },
      }),
    }

    await expect(
      search(client, 'legal_authorities', 'test'),
    ).rejects.toMatchObject({
      message: 'Search failed. Search provider error: Error.',
      cause: providerError,
    })
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

  it('keys evidence ids on position when a document repeats a paragraph number', () => {
    // LegalDocML marks block-quoted paragraphs from a cited judgment as
    // paragraphs carrying that judgment's numbering, and appendices restart at
    // 1. Both produce duplicate paragraphNumbers in one document.
    const hit = {
      ...authority(),
      paragraphs: [
        {
          id: 'p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 7,
          text: 'The appellant relied on the duty of care owed to visitors.',
        },
        {
          id: 'p2',
          documentId: 'uksc-2024-3',
          paragraphNumber: 2,
          text: 'Quoted: the duty of care question was settled in Caparo.',
        },
      ],
    } as unknown as LegalSearchHit

    const snippets = extractLegalSearchSnippets(hit, 'duty of care')

    expect(snippets).toHaveLength(2)
    expect(new Set(snippets.map((snippet) => snippet.evidenceId)).size).toBe(2)
    // The number the judgment prints is preserved for display, duplicates and all.
    expect(snippets.map((snippet) => snippet.paragraphNumber)).toEqual([7, 2])
  })

  it('matches a zero-padded tribunal citation against the unpadded form', () => {
    // Find Case Law returns `[2024] UKUT 00236 (IAC)`; a reader types the form
    // the tribunal's own headnote prints.
    expect(normalizeCitationValue('[2024] UKUT 00236 (IAC)')).toBe(
      normalizeCitationValue('[2024] UKUT 236 (IAC)'),
    )
    expect(normalizeCitationValue('[2024] UKFTT 001074 (TC)')).toBe(
      '[2024] ukftt 1074 (tc)',
    )
    // Senior court citations are unaffected.
    expect(normalizeCitationValue('[2024] UKSC 22')).toBe('[2024] uksc 22')

    const padded = {
      ...authority(),
      id: 'ukut-iac-2024-236',
      neutralCitation: '[2024] UKUT 00236 (IAC)',
    } as unknown as LegalSearchHit
    const other = {
      ...authority(),
      id: 'uksc-2024-3',
      neutralCitation: '[2024] UKSC 3',
    } as unknown as LegalSearchHit

    const ranked = rankLegalSearchHitsByExactMatch(
      [other, padded],
      '[2024] UKUT 236 (IAC)',
    )

    expect(ranked[0]?.id).toBe('ukut-iac-2024-236')
  })

  describe('getIndexStatus', () => {
    function statsClient(
      getStats: () => Promise<{ numberOfDocuments: number }>,
    ) {
      return { index: () => ({ getStats }) }
    }

    it('reports a populated index as ready with its document count', async () => {
      const state = await getIndexStatus(
        statsClient(async () => ({ numberOfDocuments: 42 })),
        'legal_authorities',
      )

      expect(state).toEqual({
        status: 'ready',
        exists: true,
        documentCount: 42,
      })
    })

    it('reports an existing but empty index as empty', async () => {
      const state = await getIndexStatus(
        statsClient(async () => ({ numberOfDocuments: 0 })),
        'legal_authorities',
      )

      expect(state).toEqual({
        status: 'empty',
        exists: true,
        documentCount: 0,
      })
    })

    it('reports a missing index instead of throwing', async () => {
      const missing = Object.assign(new Error('Index not found.'), {
        code: 'index_not_found',
      })
      const state = await getIndexStatus(
        statsClient(async () => {
          throw missing
        }),
        'legal_authorities',
      )

      expect(state).toEqual({
        status: 'missing',
        exists: false,
        documentCount: 0,
        reason: 'index_not_found',
      })
    })

    it('reports rejected credentials as unreachable with the provider code', async () => {
      const denied = Object.assign(new Error('Invalid API key.'), {
        code: 'invalid_api_key',
      })
      const state = await getIndexStatus(
        statsClient(async () => {
          throw denied
        }),
        'legal_authorities',
      )

      expect(state).toEqual({
        status: 'unreachable',
        exists: false,
        documentCount: null,
        reason: 'invalid_api_key',
      })
    })

    it('reports a hung probe as unreachable instead of hanging', async () => {
      const state = await getIndexStatus(
        statsClient(() => new Promise(() => undefined)),
        'legal_authorities',
        10,
      )

      expect(state).toEqual({
        status: 'unreachable',
        exists: false,
        documentCount: null,
        reason: 'timeout',
      })
    })
  })
})
