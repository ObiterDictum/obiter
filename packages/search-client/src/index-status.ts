import { searchProviderCode } from './search-errors'

export type SearchIndexStatus = 'ready' | 'empty' | 'missing' | 'unreachable'

export interface SearchIndexState {
  status: SearchIndexStatus
  exists: boolean
  documentCount: number | null
  reason?: string
}

type IndexStatsClient = {
  index(indexName: string): {
    getStats(): Promise<{ numberOfDocuments: number }>
  }
}

class SearchIndexProbeTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`Search index probe timed out after ${timeoutMs}ms.`)
    this.name = 'SearchIndexProbeTimeout'
  }
}

export async function getIndexStatus(
  client: IndexStatsClient,
  indexName: string,
  timeoutMs = 2000,
): Promise<SearchIndexState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SearchIndexProbeTimeout(timeoutMs)),
      timeoutMs,
    )
    timer.unref?.()
  })

  try {
    const stats = await Promise.race([
      client.index(indexName).getStats(),
      timeout,
    ])
    return stats.numberOfDocuments > 0
      ? {
          status: 'ready',
          exists: true,
          documentCount: stats.numberOfDocuments,
        }
      : { status: 'empty', exists: true, documentCount: 0 }
  } catch (error) {
    if (error instanceof SearchIndexProbeTimeout) {
      return {
        status: 'unreachable',
        exists: false,
        documentCount: null,
        reason: 'timeout',
      }
    }
    const code = searchProviderCode(error)
    if (code === 'index_not_found') {
      return {
        status: 'missing',
        exists: false,
        documentCount: 0,
        reason: code,
      }
    }
    return {
      status: 'unreachable',
      exists: false,
      documentCount: null,
      reason:
        error instanceof TypeError ? 'connection_failed' : (code ?? 'unknown'),
    }
  } finally {
    clearTimeout(timer)
  }
}
