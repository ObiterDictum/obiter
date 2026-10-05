/**
 * The one rolling window every Find Case Law HTTP attempt draws on.
 *
 * The provider charges a budget immediately before each attempt it dispatches,
 * so the window counts attempts rather than operations: one search walk may
 * spend one charge per Atom page plus one per detail fetch, and a LegalDocML
 * fetch that falls back to HTML spends two. A failing network call still spent
 * its charge because the attempt was made; a URL refused before dispatch spends
 * nothing.
 */
export const mojRequestWindowMs = 5 * 60 * 1000

/**
 * The outcome of one attempt to spend a slot in an upstream request budget.
 *
 * `unavailable` means the authority could not answer, so the caller must fail
 * closed and dispatch nothing: an uncharged request cannot be shown to be
 * inside the allowance.
 */
export type MojRequestCharge =
  | { status: 'allowed' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'unavailable' }

/**
 * The seam every provider fetch charges. One implementation is process-local
 * (`createMojRateLimiter`); the API's is a Postgres ledger shared by every
 * replica, so N replicas share one allowance instead of multiplying it. The
 * provider does not know which authority it holds.
 */
export interface MojRequestBudget {
  charge(now?: number): Promise<MojRequestCharge>
}

/**
 * A per-process sliding window, kept as a backstop rather than the authority.
 *
 * It cannot bound the cluster: N replicas each get `limit`. In the API it sits
 * behind the shared ledger, which can only tighten it. Bulk ingestion, which
 * has no application-database connection, still uses it alone.
 */
export function createMojRateLimiter(limit: number) {
  const windowMs = mojRequestWindowMs
  const timestamps: number[] = []

  function take(now = Date.now()) {
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift()
    }

    if (timestamps.length >= limit) {
      const retryAfterSeconds = Math.ceil(
        (timestamps[0] + windowMs - now) / 1000,
      )
      return { allowed: false as const, retryAfterSeconds }
    }

    timestamps.push(now)
    return { allowed: true as const, retryAfterSeconds: 0 }
  }

  return {
    take,
    async charge(now = Date.now()): Promise<MojRequestCharge> {
      const taken = take(now)
      return taken.allowed
        ? { status: 'allowed' }
        : { status: 'rate_limited', retryAfterSeconds: taken.retryAfterSeconds }
    },
  }
}
