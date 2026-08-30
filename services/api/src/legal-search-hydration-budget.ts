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

export class LegalSearchHydrationBudget {
  private readonly inFlight = new Set<string>()
  private readonly userMissTimestamps = new Map<string, number[]>()

  constructor(
    private readonly config: LegalSearchHydrationBudgetConfig = DEFAULT_LEGAL_SEARCH_HYDRATION_BUDGET_CONFIG,
  ) {}

  tryBeginHydration(userId: string, key: string): HydrationEnqueueResult {
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

  private userMissCount(userId: string) {
    const cutoff = Date.now() - this.config.windowMs
    const timestamps = (this.userMissTimestamps.get(userId) ?? []).filter(
      (value) => value >= cutoff,
    )
    this.userMissTimestamps.set(userId, timestamps)
    return timestamps.length
  }

  private recordUserMiss(userId: string) {
    const timestamps = this.userMissTimestamps.get(userId) ?? []
    timestamps.push(Date.now())
    this.userMissTimestamps.set(userId, timestamps)
  }
}
