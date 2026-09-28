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
 * The shared budget subject for anonymous provider access. It is a server
 * constant, not a caller-supplied id or IP, so every anonymous caller draws on
 * one bounded window instead of receiving an allowance each. The colon keeps
 * it outside the id alphabet a session user id can use, so it can never merge
 * with a real user's window.
 */
export const ANONYMOUS_HYDRATION_SUBJECT = 'anonymous:shared'

/**
 * The outcome of an admission request against a budget authority. `admitted`
 * carries the lease the caller must release; `deduped` means an equivalent
 * operation is already in flight in this process; `unavailable` means the
 * authority could not answer and the caller must fail closed.
 */
export type HydrationAdmission =
  | { status: 'admitted'; leaseId: string }
  | { status: 'deduped' }
  | { status: 'budget_exceeded' }
  | { status: 'unavailable' }

/**
 * The admission authority every provider-reaching operation reserves against.
 *
 * One implementation is process-local (`LegalSearchHydrationBudget`); another
 * is shared across replicas (`PostgresLegalHydrationLedger`, the application
 * database). `admit` both bounds in-flight work and, when `chargeMiss` is set,
 * counts a distinct miss against `subject`'s rolling window. `complete`
 * releases the lease exactly once; a lease that is never released expires on
 * its own so a crashed holder cannot hold capacity forever.
 */
export interface LegalHydrationLedger {
  admit(
    subject: string,
    key: string,
    chargeMiss: boolean,
  ): Promise<HydrationAdmission>
  complete(leaseId: string): Promise<void>
}

/**
 * In-process admission state. Each API replica has its own in-flight set and
 * per-subject windows, so N processes behind ingress multiply the effective
 * allowance. It is the fallback for tests and for a single-process
 * development server; production crosses `PostgresLegalHydrationLedger`,
 * whose state all replicas share.
 */
export class LegalSearchHydrationBudget implements LegalHydrationLedger {
  private readonly inFlight = new Set<string>()
  private readonly userMissTimestamps = new Map<string, number[]>()
  private readonly config: LegalSearchHydrationBudgetConfig

  constructor(config: Partial<LegalSearchHydrationBudgetConfig> = {}) {
    this.config = { ...DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG, ...config }
    // A non-positive window or retention cap silently disables the bound it
    // is meant to enforce, so reject it rather than letting admission through.
    if (this.config.windowMs <= 0) {
      throw new Error('Legal hydration windowMs must be positive.')
    }
    if (this.config.retainedUserWindowMax <= 0) {
      throw new Error('Legal hydration retainedUserWindowMax must be positive.')
    }
  }

  tryBeginHydration(userId: string, key: string): HydrationEnqueueResult {
    return this.reserve(userId, key, true)
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

  async admit(
    subject: string,
    key: string,
    chargeMiss: boolean,
  ): Promise<HydrationAdmission> {
    const reservation = this.reserve(subject, key, chargeMiss)
    if (reservation.status === 'queued') {
      return { status: 'admitted', leaseId: key }
    }
    return reservation
  }

  async complete(leaseId: string): Promise<void> {
    this.completeHydration(leaseId)
  }

  private reserve(
    userId: string,
    key: string,
    chargeMiss: boolean,
  ): HydrationEnqueueResult {
    this.pruneExpiredUserMisses()
    if (this.inFlight.has(key)) return { status: 'deduped' }
    if (this.inFlight.size >= this.config.queueMax) {
      return { status: 'budget_exceeded' }
    }
    if (chargeMiss && this.userMissCount(userId) >= this.config.perClientMax) {
      return { status: 'budget_exceeded' }
    }

    if (chargeMiss) this.recordUserMiss(userId)
    this.inFlight.add(key)
    return { status: 'queued' }
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
  | { status: 'unavailable' }
  | { status: 'unauthenticated' }
  | { status: 'failed' }

export type HydrationGateStartResult =
  | { status: 'started' }
  | { status: 'deduped' }
  | { status: 'budget_exceeded' }
  | { status: 'unavailable' }
  | { status: 'unauthenticated' }

export interface HydrationGateOptions {
  /**
   * Whether this admission counts a distinct miss against the subject's
   * window. Downstream work already paid for by an admitted request (the
   * detached detail pass a foreground fetch starts) still takes an in-flight
   * lease but must not spend the subject's miss allowance a second time.
   */
  chargeMiss?: boolean
}

interface LaunchedOperation<T> {
  admitted: Promise<HydrationGateStartResult>
  completion: Promise<T>
}

/**
 * The single boundary every product request that can reach Find Case Law
 * crosses. It reserves admission before the operation runs, shares one
 * in-flight promise for equivalent work within this process, and always
 * releases the lease on settle, whether the operation succeeded, failed, was
 * rate limited or was cancelled. A caller that asks for work it may not do
 * gets no upstream fetch, no corpus write and no queued job, because the
 * operation is never invoked.
 *
 * The in-process single-flight map is an optimisation: it saves a duplicate
 * provider fetch for two callers in this process. It is not the source of
 * global truth, and it does not deduplicate across replicas; that truth is
 * the ledger's shared miss window and unexpired-lease bound.
 */
export class LegalSourceHydrationGate {
  private readonly operations = new Map<string, LaunchedOperation<unknown>>()

  constructor(private readonly ledger: LegalHydrationLedger) {}

  async run<T>(
    subject: string | null,
    key: string,
    operation: () => Promise<T>,
  ): Promise<HydrationGateRunResult<T>> {
    if (!subject) return { status: 'unauthenticated' }

    const existing = this.operations.get(key)
    if (existing) return this.join<T>(existing)

    const launched = this.launch(subject, key, operation, true)
    const admitted = await launched.admitted
    if (admitted.status !== 'started') {
      void launched.completion.catch(() => {})
      return admitted.status === 'unavailable'
        ? { status: 'unavailable' }
        : { status: 'budget_exceeded' }
    }

    return launched.completion.then(
      (value) => ({ status: 'ok' as const, value }),
      () => ({ status: 'failed' as const }),
    )
  }

  async start<T>(
    subject: string | null,
    key: string,
    operation: () => Promise<T>,
    options: HydrationGateOptions = {},
  ): Promise<HydrationGateStartResult> {
    if (!subject) return { status: 'unauthenticated' }

    const existing = this.operations.get(key)
    if (existing) {
      return existing.admitted.then((admitted) =>
        admitted.status === 'started' ? { status: 'deduped' } : admitted,
      )
    }

    const launched = this.launch(
      subject,
      key,
      operation,
      options.chargeMiss ?? true,
    )
    // Background callers discard the value. Keep a handled copy so a
    // rejection cannot surface as an unhandled rejection; the operation
    // reports its own failures where they occur.
    void launched.completion.catch(() => {})
    return launched.admitted
  }

  private async join<T>(
    existing: LaunchedOperation<unknown>,
  ): Promise<HydrationGateRunResult<T>> {
    const admitted = await existing.admitted
    if (admitted.status === 'unavailable') {
      return { status: 'unavailable' }
    }
    if (admitted.status !== 'started') {
      return { status: 'budget_exceeded' }
    }
    // SAFETY: the operations map only holds promises created for this key, and
    // every caller for one key uses the same operation type.
    return existing.completion.then(
      (value) => ({ status: 'deduped' as const, value: value as T }),
      () => ({ status: 'failed' as const }),
    )
  }

  private launch<T>(
    subject: string,
    key: string,
    operation: () => Promise<T>,
    chargeMiss: boolean,
  ): LaunchedOperation<T> {
    let resolveAdmitted: (result: HydrationGateStartResult) => void = () => {}
    const admitted = new Promise<HydrationGateStartResult>((resolve) => {
      resolveAdmitted = resolve
    })

    // Reserve the key in `operations` synchronously, before the first await,
    // so two concurrent callers for one key admit exactly once: the second
    // joins the first's admission instead of charging a second miss.
    const completion = (async () => {
      let admission: HydrationAdmission
      try {
        admission = await this.ledger.admit(subject, key, chargeMiss)
      } catch {
        admission = { status: 'unavailable' }
      }
      if (admission.status !== 'admitted') {
        resolveAdmitted({
          status:
            admission.status === 'unavailable'
              ? 'unavailable'
              : 'budget_exceeded',
        })
        throw new Error('Hydration admission rejected.')
      }
      resolveAdmitted({ status: 'started' })
      try {
        // Defer so a synchronous throw inside the operation becomes a
        // rejected promise and the `finally` still releases the lease.
        return await Promise.resolve().then(operation)
      } finally {
        // Release on settle, not on caller disconnect: there is no abort
        // path, and a lease that is never released expires on its own.
        void this.ledger.complete(admission.leaseId)
      }
    })().finally(() => {
      this.operations.delete(key)
    })

    const launched: LaunchedOperation<T> = { admitted, completion }
    this.operations.set(key, launched)
    return launched
  }
}
