import type {
  DocumentReadClient,
  SearchEnqueuedTaskPromise,
} from './index-types'
import { SearchTaskError, wrapSearchError } from './search-errors'
import {
  documentIndexingTaskTimeoutMs,
  isTaskWaitTimeout,
} from './index-settings'
import { LegalAuthoritySchema, type LegalAuthority } from '@obiter/legal-schema'
import type { SearchIndexDocumentsResult } from './index-types'

export type DocumentDeleteClient = {
  index(indexName: string): {
    deleteDocuments(documentIds: string[]): SearchEnqueuedTaskPromise
  }
}

export interface SearchIndexDeleteResult {
  taskUid?: number
  deletedCount: number
}

/**
 * Removes documents from the derived product index. Postgres stays the
 * record: callers mark the row withdrawn there first and call this to drop
 * the derived copy, never the reverse. A no-op for an empty id list so
 * callers need no length guard.
 */
export async function deleteDocuments(
  client: DocumentDeleteClient,
  indexName: string,
  documentIds: string[],
): Promise<SearchIndexDeleteResult> {
  if (documentIds.length === 0) return { deletedCount: 0 }

  try {
    const task = await client
      .index(indexName)
      .deleteDocuments(documentIds)
      .waitTask({ timeout: documentIndexingTaskTimeoutMs, interval: 100 })

    if (task.status !== 'succeeded') {
      throw new SearchTaskError(task)
    }

    return {
      taskUid: task.uid ?? task.taskUid,
      deletedCount: documentIds.length,
    }
  } catch (error) {
    if (error instanceof SearchTaskError) throw error
    if (isTaskWaitTimeout(error)) {
      throw new Error(
        'Document deletion status timed out. The Meilisearch task may still be running.',
        { cause: error },
      )
    }
    throw wrapSearchError('Document deletion failed.', error)
  }
}

export type DocumentListClient = {
  index(indexName: string): {
    // fields is the literal this helper ever fetches, not a general string:
    // the engine client is generic over the document shape, and a wide
    // string[] does not satisfy its per-shape field union.
    getDocuments(params?: {
      limit?: number
      offset?: number
      fields?: Array<'id'>
    }): Promise<{ results: Array<{ id: string }> }>
  }
}

/**
 * Lists every document id in the index, oldest first, for the parity
 * reconciler. Only the primary key is fetched; the record of what should be
 * indexed lives in Postgres, so the index is never asked for content here.
 */
export async function listDocumentIds(
  client: DocumentListClient,
  indexName: string,
  pageSize = 1000,
): Promise<string[]> {
  const ids: string[] = []
  try {
    for (;;) {
      const page = await client.index(indexName).getDocuments({
        limit: pageSize,
        offset: ids.length,
        fields: ['id'],
      })
      ids.push(...page.results.map((document) => document.id))
      if (page.results.length < pageSize) return ids
    }
  } catch (error) {
    throw wrapSearchError('Document listing failed.', error)
  }
}

export function validationFailure(
  documents: unknown[],
  messages: string[],
): SearchIndexDocumentsResult {
  const first = documents[0]
  const recordId =
    typeof first === 'object' && first !== null && 'id' in first
      ? first.id
      : undefined

  return {
    indexedCount: 0,
    failedCount: documents.length,
    errors: [
      {
        recordId: typeof recordId === 'string' ? recordId : null,
        message: messages.join('; '),
      },
    ],
  }
}

export async function getDocument(
  client: DocumentReadClient,
  indexName: string,
  documentId: string,
): Promise<LegalAuthority> {
  try {
    const document = await client.index(indexName).getDocument(documentId)
    return LegalAuthoritySchema.parse(document)
  } catch (error) {
    throw wrapSearchError('Document lookup failed.', error)
  }
}
