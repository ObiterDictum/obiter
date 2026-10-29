import type { SearchIndexingTask } from './index-types'

class SearchTaskError extends Error {
  constructor(task: SearchIndexingTask) {
    const taskId = task.uid ?? task.taskUid
    const taskLabel = typeof taskId === 'number' ? ` ${taskId}` : ''
    const errorCode = task.error?.code ?? task.error?.type
    const errorLabel = errorCode ? ` (${errorCode})` : ''

    super(
      `Meilisearch task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`,
    )
    this.name = 'SearchTaskError'
  }
}

export type SearchProviderErrorBody = {
  code?: string
  message?: string
  cause?: SearchProviderErrorBody
}

function searchProviderErrorBody(
  error: unknown,
): SearchProviderErrorBody | null {
  if (typeof error !== 'object' || error === null) return null

  const body: SearchProviderErrorBody = {}
  if ('code' in error && typeof error.code === 'string') {
    body.code = error.code
  }
  if ('message' in error && typeof error.message === 'string') {
    body.message = error.message
  }
  if ('cause' in error) {
    const nested = searchProviderErrorBody(error.cause)
    if (nested) body.cause = nested
  }
  return body
}

function searchProviderCode(error: unknown): string | null {
  const body = searchProviderErrorBody(error)
  return body?.code ?? body?.cause?.code ?? null
}

function searchProviderMessage(error: unknown): string | null {
  const body = searchProviderErrorBody(error)
  const message = body?.message ?? body?.cause?.message
  return typeof message === 'string' && message.length > 0
    ? message.replace(/\.+$/, '')
    : null
}

function wrapSearchError(message: string, error: unknown): Error {
  if (error instanceof SearchTaskError) {
    return new Error(`${message} ${error.message}`, { cause: error })
  }

  const code = searchProviderCode(error)
  const providerMessage = searchProviderMessage(error)
  const isMeilisearchApiError =
    error instanceof Error && error.name === 'MeiliSearchApiError'

  if (code || isMeilisearchApiError) {
    const detail = [code, providerMessage]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(': ')
    const named = detail.length > 0 ? detail : 'MeiliSearchApiError'
    return new Error(`${message} Search provider error: ${named}.`, {
      cause: error,
    })
  }

  const detail = error instanceof Error ? error.name : typeof error
  return new Error(`${message} Search provider error: ${detail}.`, {
    cause: error,
  })
}

export { SearchTaskError, searchProviderCode, wrapSearchError }
