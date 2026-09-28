import type { LegalFetchRequest } from '@obiter/legal-source-provider'
import {
  DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_RETAINED_USER_WINDOWS,
  DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
} from './request-limit-defaults'

export interface LegalSearchHydrationBudgetConfig {
  queueMax: number
  perClientMax: number
  windowMs: number
  retainedUserWindowMax: number
}

export const DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG: LegalSearchHydrationBudgetConfig =
  {
    queueMax: DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
    perClientMax: DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
    windowMs: DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
    retainedUserWindowMax: DEFAULT_LEGAL_SEARCH_HYDRATION_RETAINED_USER_WINDOWS,
  }

export type HydrationEnqueueResult =
  { status: 'queued' } | { status: 'deduped' } | { status: 'budget_exceeded' }

/** Trim, lowercase and collapse whitespace so equivalent queries share a key. */
function normalizeQueryText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function canonicalHydrationQueryKey(request: LegalFetchRequest) {
  return JSON.stringify({
    query: normalizeQueryText(request.query),
    court: request.court ?? null,
    jurisdiction: request.jurisdiction ?? null,
    sourceType: request.sourceType ?? 'judgment',
    dateFrom: request.dateFrom ?? null,
    dateTo: request.dateTo ?? null,
  })
}

/**
 * A document fetch is a different hydration operation from a query. The
 * namespace keeps a document id from colliding with a query whose text is the
 * same, so an id and a keyword can never share one in-flight slot.
 */
export function documentHydrationKey(documentId: string) {
  return `document:${documentId.trim().toLowerCase()}`
}

/**
 * The shared per-process budget subject for anonymous provider access. It is a
 * server constant, not a caller-supplied id or IP, so every anonymous caller
 * draws on one bounded window instead of receiving an allowance each. The
 * colon keeps it outside the id alphabet a session user id can use, so it can
 * never merge with a real user's window.
 */
export const ANONYMOUS_HYDRATION_SUBJECT = 'anonymous:shared'

/**
 * In-process only. Each API replica has its own in-flight set and per-user
 * windows, so N processes behind ingress multiply the effective allowance.
 * Share this state when more than one process serves search.
 */
export class LegalSearchHydrationBudget {
  private readonly inFlight = new Set<string>()
  private readonly userMissTimestamps = new Map<string, number[]>()
  private readonly config: LegalSearchHydrationBudgetConfig

  constructor(config: Partial<LegalSearchHydrationBudgetConfig> = {}) {
    this.config = { ...DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG, ...config }
  }

  tryBeginHydration(userId: string, key: string): HydrationEnqueueResult {
    this.pruneExpiredUserMisses()
    if (this.inFlight.has(key)) return { status: 'deduped' }
    if (this.inFlight.size >= this.config.queueMax) {
      return { status: 'budget_exceeded' }
    }
    if (this.userMissCount(userId) >= this.config.perClientMax) {
      return { status: 'budget_exceeded' }
    }

    this.recordUserMiss(userId)
    this.inFlight.add(key)
    return { status: 'queued' }
  }

  completeHydration(key: string) {
    this.inFlight.delete(key)
  }

  isInFlight(key: string) {
    return this.inFlight.has(key)
  }

  retainedUserMissWindows() {
    return this.userMissTimestamps.size
  }

  private pruneExpiredUserMisses() {
    const cutoff = Date.now() - this.config.windowMs
    // Bounded sweep: never examine more than the retention cap, then evict the
    // least recently recorded windows while still over it. The map is ordered
    // by last record because `recordUserMiss` re-inserts on every miss.
    let examined = 0
    for (const [userId, timestamps] of this.userMissTimestamps) {
      if (examined >= this.config.retainedUserWindowMax) break
      examined += 1
      const kept = timestamps.filter((value) => value >= cutoff)
      if (kept.length === 0) this.userMissTimestamps.delete(userId)
      else this.userMissTimestamps.set(userId, kept)
    }
    this.enforceRetainedWindowCap()
  }

  private enforceRetainedWindowCap() {
    while (this.userMissTimestamps.size > this.config.retainedUserWindowMax) {
      const oldest = this.userMissTimestamps.keys().next().value
      if (oldest === undefined) break
      this.userMissTimestamps.delete(oldest)
    }
  }

  private userMissCount(userId: string) {
    const timestamps = this.userMissTimestamps.get(userId)
    if (!timestamps) return 0
    const cutoff = Date.now() - this.config.windowMs
    const live = timestamps.filter((value) => value >= cutoff)
    if (live.length !== timestamps.length) {
      if (live.length === 0) this.userMissTimestamps.delete(userId)
      else this.userMissTimestamps.set(userId, live)
    }
    return live.length
  }

  private recordUserMiss(userId: string) {
    const timestamps = this.userMissTimestamps.get(userId) ?? []
    timestamps.push(Date.now())
    // Re-insert so Map iteration order stays least-recently-used first, then
    // evict the oldest windows if recording pushed the map past its cap.
    this.userMissTimestamps.delete(userId)
    this.userMissTimestamps.set(userId, timestamps)
    this.enforceRetainedWindowCap()
  }
}

export type HydrationGateRunResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'deduped'; value: T }
  | { status: 'budget_exceeded' }
  | { status: 'unauthenticated' }
  | { status: 'failed' }

export type HydrationGateStartResult =
  | { status: 'started' }
  | { status: 'deduped' }
  | { status: 'budget_exceeded' }
  | { status: 'unauthenticated' }

/**
 * The single boundary every product request that can reach Find Case Law
 * crosses. It reserves the authenticated user's budget before the operation
 * runs, shares one in-flight promise for equivalent work, and always releases
 * the reservation on success, error, rate limit or cancellation. A caller that
 * asks for work it may not do gets no upstream fetch, no corpus write and no
 * queued job, because the operation is never invoked.
 *
 * This state is per process; see `LegalSearchHydrationBudget`.
 */
export class LegalSourceHydrationGate {
  private readonly operations = new Map<string, Promise<unknown>>()

  constructor(private readonly budget: LegalSearchHydrationBudget) {}

  run<T>(
    userId: string | null,
    key: string,
    operation: () => Promise<T>,
  ): Promise<HydrationGateRunResult<T>> {
    if (!userId) return Promise.resolve({ status: 'unauthenticated' })

    const existing = this.operations.get(key)
    if (existing) {
      // SAFETY: the operations map only holds promises created below for this
      // key, and every caller for one key uses the same operation type.
      return existing.then(
        (value) => ({ status: 'deduped' as const, value: value as T }),
        () => ({ status: 'failed' as const }),
      )
    }

    const reservation = this.budget.tryBeginHydration(userId, key)
    if (reservation.status === 'budget_exceeded') {
      return Promise.resolve({ status: 'budget_exceeded' })
    }
    if (reservation.status === 'deduped') {
      // An in-flight key this gate did not create (a direct budget caller).
      // Fail closed rather than run an unmetered fetch.
      return Promise.resolve({ status: 'budget_exceeded' })
    }

    // Defer the operation so a synchronous throw inside it becomes a rejected
    // promise and the `finally` still releases the reservation.
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        this.operations.delete(key)
        this.budget.completeHydration(key)
      })
    this.operations.set(key, promise)
    return promise.then(
      (value) => ({ status: 'ok' as const, value }),
      // The operation failed after the reservation was made. The `finally`
      // above already released the slot and the attempt stays counted; the
      // caller sees a typed failure rather than a bare rejection.
      () => ({ status: 'failed' as const }),
    )
  }

  start<T>(
    userId: string | null,
    key: string,
    operation: () => Promise<T>,
  ): HydrationGateStartResult {
    if (!userId) return { status: 'unauthenticated' }
    if (this.operations.has(key)) return { status: 'deduped' }

    const reservation = this.budget.tryBeginHydration(userId, key)
    if (reservation.status === 'budget_exceeded') {
      return { status: 'budget_exceeded' }
    }
    if (reservation.status === 'deduped') return { status: 'deduped' }

    // Defer the operation so a synchronous throw inside it becomes a rejected
    // promise and the `finally` still releases the reservation.
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        this.operations.delete(key)
        this.budget.completeHydration(key)
      })
    this.operations.set(key, promise)
    // Background callers discard the value. Keep a handled copy so a rejection
    // cannot surface as an unhandled rejection; the operation reports its own
    // failures where they occur.
    void promise.catch(() => {})
    return { status: 'started' }
  }
}
