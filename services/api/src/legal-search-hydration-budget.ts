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

const DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG: LegalSearchHydrationBudgetConfig =
  {
    queueMax: DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
    perClientMax: DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
    windowMs: DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
    retainedUserWindowMax: DEFAULT_LEGAL_SEARCH_HYDRATION_RETAINED_USER_WINDOWS,
  }

export type HydrationEnqueueResult =
  { status: 'queued' } | { status: 'deduped' } | { status: 'budget_exceeded' }

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

export function documentHydrationKey(documentId: string) {
  return `document:${documentId.trim().toLowerCase()}`
}

export const ANONYMOUS_HYDRATION_SUBJECT = 'anonymous:shared'

export type HydrationAdmission =
  | { status: 'admitted'; leaseId: string }
  | { status: 'deduped' }
  | { status: 'budget_exceeded' }
  | { status: 'unavailable' }

export interface LegalHydrationLedger {
  admit(
    subject: string,
    key: string,
    chargeMiss: boolean,
  ): Promise<HydrationAdmission>
  complete(leaseId: string): Promise<void>
}

export class LegalSearchHydrationBudget implements LegalHydrationLedger {
  private readonly inFlight = new Set<string>()
  private readonly userMissTimestamps = new Map<string, number[]>()
  private readonly config: LegalSearchHydrationBudgetConfig

  constructor(config: Partial<LegalSearchHydrationBudgetConfig> = {}) {
    this.config = { ...DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG, ...config }
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
  chargeMiss?: boolean
}

interface LaunchedOperation<T> {
  admitted: Promise<HydrationGateStartResult>
  completion: Promise<T>
}

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
        return await Promise.resolve().then(operation)
      } finally {
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
