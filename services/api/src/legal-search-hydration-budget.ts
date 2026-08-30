import type { LegalFetchRequest } from '@obiter/legal-source-provider'
import {
  DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
} from './request-limit-defaults'

export interface LegalSearchHydrationBudgetConfig {
  queueMax: number
  perClientMax: number
  windowMs: number
}

export const DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG: LegalSearchHydrationBudgetConfig =
  {
    queueMax: DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
    perClientMax: DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
    windowMs: DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
  }

export type HydrationEnqueueResult =
  { status: 'queued' } | { status: 'deduped' } | { status: 'budget_exceeded' }

export function canonicalHydrationQueryKey(request: LegalFetchRequest) {
  return JSON.stringify({
    query: request.query.trim().toLowerCase(),
    court: request.court ?? null,
    jurisdiction: request.jurisdiction ?? null,
    sourceType: request.sourceType ?? 'judgment',
    dateFrom: request.dateFrom ?? null,
    dateTo: request.dateTo ?? null,
  })
}

/**
 * In-process only. Each API replica has its own in-flight set and per-user
 * windows, so N processes behind ingress multiply the effective allowance.
 * Share this state when more than one process serves search.
 */
export class LegalSearchHydrationBudget {
  private readonly inFlight = new Set<string>()
  private readonly userMissTimestamps = new Map<string, number[]>()

  constructor(
    private readonly config: LegalSearchHydrationBudgetConfig = DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG,
  ) {}

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
    for (const [userId, timestamps] of this.userMissTimestamps) {
      const kept = timestamps.filter((value) => value >= cutoff)
      if (kept.length === 0) this.userMissTimestamps.delete(userId)
      else this.userMissTimestamps.set(userId, kept)
    }
  }

  private userMissCount(userId: string) {
    return this.userMissTimestamps.get(userId)?.length ?? 0
  }

  private recordUserMiss(userId: string) {
    const timestamps = this.userMissTimestamps.get(userId) ?? []
    timestamps.push(Date.now())
    this.userMissTimestamps.set(userId, timestamps)
  }
}
