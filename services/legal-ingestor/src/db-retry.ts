/**
 * Bounded retry for the two Postgres errors that mean "the transaction was
 * rolled back, nothing was written".
 *
 * `40001` (serialisation failure) and `40P01` (deadlock detected) are the only
 * two codes retried. Both are raised by the server after it has already rolled
 * the transaction back, so re-running the operation cannot double-apply
 * anything: safety comes from Postgres's own guarantee, not from an assumption
 * about what the operation does. Every other error — including an error with no
 * SQLSTATE at all, such as a connection failure or a constraint violation — is
 * rethrown immediately, because retrying a partial or rejected write is how a
 * visible failure turns into a silent duplicate.
 *
 * The retry is bounded by both attempts and elapsed time, and a final failure
 * is rethrown with the SQLSTATE and the attempt count attached, so a run that
 * gave up is attributable rather than merely slow.
 */

const retryableSqlStates = new Set(['40001', '40P01'])

const defaultAttempts = 4
const defaultMaxElapsedMs = 5_000
const baseDelayMs = 25

function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export interface ConcurrencyRetryOptions {
  /** Total attempts, including the first. */
  attempts?: number
  /** Wall-clock ceiling for the whole operation, including the delays. */
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

      // Jittered backoff: two writers retrying on the same fixed schedule
      // collide again on the same lock.
      const ceilingMs = baseDelayMs * 2 ** (attempt - 1)
      const delayMs = Math.round(ceilingMs * (0.5 + Math.random() / 2))
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
