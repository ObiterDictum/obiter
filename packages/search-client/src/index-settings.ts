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

/**
 * Meilisearch comparison operators take numeric operands only, so a range
 * filter cannot read the ISO `dateDecided` string. The index carries this
 * derived companion field for range filtering; `dateDecided` remains the
 * authority and the only date the domain schema and callers ever see.
 */
export const dateDecidedTimestampField = 'dateDecidedTimestamp'

/**
 * Midnight UTC for an ISO `YYYY-MM-DD` date. Every indexed value lands on a day
 * boundary, so an inclusive `dateTo` needs no end-of-day adjustment: a document
 * decided on the boundary day compares equal, not greater.
 */
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

/**
 * Projects a validated authority into the shape sent to the engine. The schema
 * has already guaranteed `dateDecided` is an ISO date, so a null here means the
 * two have drifted apart rather than that a caller passed something odd.
 */
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
/**
 * The settings createIndex applies, plus the defaults search falls back to,
 * held in one place so callers can report exactly what ran. The benchmark
 * embeds this verbatim, which is what stops a reported tuning decision from
 * quietly disagreeing with the committed value.
 */
export const legalSearchIndexSettings = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  prefixSearch: 'disabled',
  matchingStrategy: 'all',
  // Swept across the full benchmark at null, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45
  // and 0.5. Everything from 0.2 to 0.35 beats 0.5 on top-1 and top-3 and is
  // worse on nothing, because the only case the floor is load-bearing for is
  // "claimnt", whose sole candidate scores 0.0928. The lowest legitimate typo
  // match measured is "Rizwun" at 0.3655. 0.25 sits near the middle of that
  // gap, leaving 0.157 of headroom over the junk match and 0.116 under the
  // recall one. The other three no-answer cases return nothing even with the
  // floor removed entirely, so they do not constrain this value.
  //
  // Those scores come from the synthetic benchmark fixture, and ranking scores
  // depend on corpus statistics, so re-measure this on a real corpus before
  // trusting it. See the calibration note in the package README.
  rankingScoreThreshold: 0.25,
  stopWordCount: legalStopWords.length,
} as const

const indexSetupTaskTimeoutMs = 10 * 60_000
export const documentIndexingTaskTimeoutMs = 30 * 60_000

/**
 * Search-time parameters this server rejects as unknown.
 *
 * `createIndex` can only discover what an old server cannot be *configured*
 * with. This finds what it cannot be *asked* for, which is a separate gap and
 * was the larger one: Meilisearch added `rankingScoreThreshold` in 1.9, and a
 * 1.8 server answers "Unknown field `rankingScoreThreshold`" to every non-empty
 * query. Left undetected that is 51 of 54 benchmark cases failing as search
 * errors, which looks like a broken index rather than an old server.
 *
 * One probe query, run once, rather than a per-search retry: a retry loop would
 * hide the gap inside every call site and make the numbers depend on which
 * queries happened to be tried.
 */
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
    // MeiliSearchApiError puts the provider's message on `message` itself; the
    // `cause` is the parsed error body, not a string.
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

/**
 * Index settings bundle for a product index other than legal_authorities.
 * createIndex above is this function with the judgment settings; the
 * legislation provisions index passes its own. One code path applies
 * settings so the two indexes cannot drift in how they handle old servers.
 */
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
    // Optional only in the sense that an older server cannot be given it. It is
    // load-bearing where it applies: `minimumShortWordPrecision` in the
    // benchmark baseline rests on prefix search being off.
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
  // MeiliSearchApiError carries the raw Response. A 404 from a settings route
  // means the route is absent from this server's version.
  return (
    error instanceof Error &&
    'response' in error &&
    error.response instanceof Response &&
    error.response.status === 404
  )
}

/**
 * Applies a setting the server may not have, checking with a read first.
 *
 * The read is not politeness. Writing to a settings route Meilisearch 1.8.3 does
 * not have returns 404 and then wedges the index: measured with plain curl, a
 * `stop-words` write succeeds 5 times out of 5 on its own at 67ms, and times out
 * 4 times out of 5 when it follows a `prefix-search` write to the absent route.
 * A read of the same absent route is harmless — 5 out of 5, same 67ms — so
 * support is established by reading and the unsupported write is never sent.
 *
 * Catching the write's 404 is therefore not enough. The damage is done by
 * issuing it, and it lands on whatever request comes next, which makes it look
 * like an unrelated flake somewhere downstream.
 */
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

  // Meilisearch v1.53 enqueues index creation, so a duplicate surfaces as a
  // failed waitTask: SearchTaskError('Meilisearch task <n> failed
  // (index_already_exists).') with no .code/.cause. Match the async form here.
  return error instanceof Error && /index_already_exists/.test(error.message)
}
