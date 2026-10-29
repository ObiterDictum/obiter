const retryableSqlStates = new Set(['40001', '40P01'])

const defaultAttempts = 4
const defaultMaxElapsedMs = 5_000
const baseDelayMs = 25

function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }

  const code: unknown = error.code
  return typeof code === 'string' ? code : null
}

export interface ConcurrencyRetryOptions {
  attempts?: number
  maxElapsedMs?: number
}

export async function withConcurrencyRetry<T>(
  operation: () => Promise<T>,
  options: ConcurrencyRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? defaultAttempts
  const maxElapsedMs = options.maxElapsedMs ?? defaultMaxElapsedMs
  const startedAt = Date.now()

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const sqlState = sqlStateOf(error)

      if (sqlState === null || !retryableSqlStates.has(sqlState)) {
        throw error
      }

      const elapsedMs = Date.now() - startedAt
      if (attempt >= attempts || elapsedMs >= maxElapsedMs) {
        throw new Error(
          `Writes failed with SQLSTATE ${sqlState} and were not retried further: ${attempt} attempt(s) in ${elapsedMs}ms.`,
          { cause: error },
        )
      }

      const ceilingMs = baseDelayMs * 2 ** (attempt - 1)
      const delayMs = Math.round(ceilingMs * (0.5 + Math.random() / 2))
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
