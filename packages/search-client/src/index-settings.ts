import type { LegalAuthority } from '@obiter/legal-schema'
import { legalAuthoritiesSchema } from '@obiter/legal-schema'
import {
  meilisearchDocumentPayloadMaxBytes,
  partitionByUtf8JsonPayload,
} from './document-payload-batches'
import { SearchTaskError, wrapSearchError } from './search-errors'
import { validationFailure } from './index-documents'
import type {
  DocumentIndexClient,
  IndexDocumentsOptions,
  IndexSetupClient,
  SearchClient,
  SearchEnqueuedTaskPromise,
  SearchIndexDocumentsResult,
  SearchIndexOptions,
  SearchIndexResult,
  SearchIndexingTask,
} from './index-types'

const searchableAttributes = [
  'id',
  'title',
  'neutralCitation',
  'paragraphs.text',
]

export const dateDecidedTimestampField = 'dateDecidedTimestamp'

export function toDateDecidedTimestamp(isoDate: string): number | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  return Number.isNaN(timestamp) ? null : timestamp
}

function toIndexedLegalAuthority(document: LegalAuthority) {
  const timestamp = toDateDecidedTimestamp(document.dateDecided)

  if (timestamp === null) {
    throw new Error(
      `Cannot derive ${dateDecidedTimestampField} for document ${document.id}: dateDecided "${document.dateDecided}" passed schema validation but is not an ISO date.`,
    )
  }

  return { ...document, [dateDecidedTimestampField]: timestamp }
}

const filterableAttributes = [
  'court',
  'jurisdiction',
  'sourceType',
  'dateDecided',
  dateDecidedTimestampField,
]
const sortableAttributes = ['dateDecided']
const legalStopWords = [
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
]
export const legalStopWordSet = new Set(legalStopWords)
export const searchSummaryAttributes = [
  'id',
  'title',
  'neutralCitation',
  'court',
  'jurisdiction',
  'dateDecided',
  'sourceType',
  'sourceUrl',
]
const rankingRules = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'exactness',
  'sort',
]
export const legalSearchIndexSettings = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  prefixSearch: 'disabled',
  matchingStrategy: 'all',
  rankingScoreThreshold: 0.25,
  stopWordCount: legalStopWords.length,
} as const

const indexSetupTaskTimeoutMs = 10 * 60_000
export const documentIndexingTaskTimeoutMs = 30 * 60_000

export async function detectUnsupportedSearchFeatures(
  client: SearchClient,
  indexName: string,
): Promise<string[]> {
  try {
    await client.index(indexName).search('', {
      limit: 1,
      rankingScoreThreshold: legalSearchIndexSettings.rankingScoreThreshold,
    })
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('rankingScoreThreshold')) {
      return ['rankingScoreThreshold']
    }
    throw wrapSearchError('Search feature probe failed.', error)
  }
}

export async function createIndex(
  client: IndexSetupClient,
  indexName: string,
  options: SearchIndexOptions = {},
): Promise<SearchIndexResult> {
  return setupIndexWithSettings(
    client,
    indexName,
    {
      searchableAttributes,
      filterableAttributes,
      sortableAttributes,
      rankingRules,
      prefixSearch: legalSearchIndexSettings.prefixSearch,
      stopWords: legalStopWords,
      minWordSizeForTypos: {
        ...legalSearchIndexSettings.minWordSizeForTypos,
      },
    },
    options,
  )
}

export interface ProductIndexSettings {
  searchableAttributes: string[]
  filterableAttributes: string[]
  sortableAttributes: string[]
  rankingRules: string[]
  prefixSearch: 'disabled' | 'indexingTime'
  stopWords: string[]
  minWordSizeForTypos: { oneTypo: number; twoTypos: number }
}

export async function setupIndexWithSettings(
  client: IndexSetupClient,
  indexName: string,
  settings: ProductIndexSettings,
  options: SearchIndexOptions = {},
): Promise<SearchIndexResult> {
  let taskUid: number | undefined
  const unsupportedSettings: string[] = []

  try {
    const primaryKey = options.primaryKey ?? 'id'
    const createTask = client.createIndex(indexName, { primaryKey })
    const task = await createTask
    taskUid = task.taskUid
    await waitForSucceededTask(createTask, indexSetupTaskTimeoutMs)
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw wrapSearchError('Search index setup failed.', error)
    }
  }

  try {
    const index = client.index(indexName)
    await waitForSucceededTask(
      index.updateSearchableAttributes(settings.searchableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateFilterableAttributes(settings.filterableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateSortableAttributes(settings.sortableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateRankingRules(settings.rankingRules),
      indexSetupTaskTimeoutMs,
    )
    await applyOptionalSetting(
      'prefixSearch',
      () => index.getPrefixSearch(),
      () => index.updatePrefixSearch(settings.prefixSearch),
      options.allowUnsupportedSettings ?? false,
      unsupportedSettings,
    )
    await waitForSucceededTask(
      index.updateStopWords(settings.stopWords),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateTypoTolerance({
        minWordSizeForTypos: { ...settings.minWordSizeForTypos },
      }),
      indexSetupTaskTimeoutMs,
    )

    return { taskUid, unsupportedSettings }
  } catch (error) {
    throw wrapSearchError('Search index setup failed.', error)
  }
}

export async function indexDocuments(
  client: DocumentIndexClient,
  indexName: string,
  documents: unknown[],
  options: IndexDocumentsOptions = {},
): Promise<SearchIndexDocumentsResult> {
  const parsed = legalAuthoritiesSchema.safeParse(documents)

  if (!parsed.success) {
    return validationFailure(
      documents,
      parsed.error.issues.map((issue) => issue.message),
    )
  }

  const indexable = parsed.data.map(toIndexedLegalAuthority)
  const capBytes = options.maxPayloadBytes ?? meilisearchDocumentPayloadMaxBytes
  const batches = partitionByUtf8JsonPayload(indexable, capBytes)

  if (batches.length === 0) {
    return { indexedCount: 0, failedCount: 0, errors: [] }
  }

  const index = client.index(indexName)
  let indexedCount = 0

  try {
    for (const [batchIndex, batch] of batches.entries()) {
      options.onProgress?.({
        batchNumber: batchIndex + 1,
        batchCount: batches.length,
        batchDocumentCount: batch.length,
        indexedCount,
        totalDocuments: parsed.data.length,
      })

      const task = await index
        .addDocuments(batch, {
          primaryKey: 'id',
        })
        .waitTask({ timeout: documentIndexingTaskTimeoutMs, interval: 100 })

      if (task.status !== 'succeeded') {
        const remaining = parsed.data.length - indexedCount
        return indexingTaskFailure(remaining, task, indexedCount)
      }

      const batchIndexed =
        typeof task.details?.indexedDocuments === 'number'
          ? task.details.indexedDocuments
          : batch.length
      indexedCount += batchIndexed
      const batchFailed = Math.max(batch.length - batchIndexed, 0)
      if (batchFailed > 0) {
        return {
          indexedCount,
          failedCount: parsed.data.length - indexedCount,
          errors: [
            {
              recordId: null,
              message:
                'Indexing task completed without indexing every document.',
            },
          ],
        }
      }
    }

    return {
      indexedCount,
      failedCount: Math.max(parsed.data.length - indexedCount, 0),
      errors:
        parsed.data.length - indexedCount > 0
          ? [
              {
                recordId: null,
                message:
                  'Indexing task completed without indexing every document.',
              },
            ]
          : [],
    }
  } catch (error) {
    if (isTaskWaitTimeout(error)) {
      throw new Error(
        'Document indexing status timed out. The Meilisearch task may still be running.',
        { cause: error },
      )
    }
    throw wrapSearchError('Document indexing failed.', error)
  }
}

function isUnsupportedSettingError(error: unknown) {
  return (
    error instanceof Error &&
    'response' in error &&
    error.response instanceof Response &&
    error.response.status === 404
  )
}

async function applyOptionalSetting(
  name: string,
  probe: () => Promise<string>,
  task: () => SearchEnqueuedTaskPromise,
  allowUnsupported: boolean,
  unsupported: string[],
) {
  if (allowUnsupported) {
    try {
      await probe()
    } catch (error) {
      if (!isUnsupportedSettingError(error)) throw error
      unsupported.push(name)
      return
    }
  }

  await waitForSucceededTask(task(), indexSetupTaskTimeoutMs)
}

export function isTaskWaitTimeout(error: unknown) {
  return error instanceof Error && /timed out|timeout/i.test(error.message)
}

async function waitForSucceededTask(
  task: SearchEnqueuedTaskPromise,
  timeout = 30_000,
): Promise<SearchIndexingTask> {
  const completed = await task.waitTask({ timeout, interval: 100 })
  if (completed.status !== 'succeeded') {
    throw new SearchTaskError(completed)
  }
  return completed
}

function indexingTaskFailure(
  failedCount: number,
  task: SearchIndexingTask,
  indexedCount = 0,
): SearchIndexDocumentsResult {
  const taskId = task.uid ?? task.taskUid
  const taskLabel = typeof taskId === 'number' ? ` ${taskId}` : ''
  const errorCode = task.error?.code ?? task.error?.type
  const errorLabel = errorCode ? ` (${errorCode})` : ''

  return {
    indexedCount,
    failedCount,
    errors: [
      {
        recordId: null,
        message: `Indexing task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`,
      },
    ],
  }
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  if ('code' in error && error.code === 'index_already_exists') {
    return true
  }

  const cause = 'cause' in error ? error.cause : undefined
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'index_already_exists'
  ) {
    return true
  }

  return error instanceof Error && /index_already_exists/.test(error.message)
}
