import { useQuery } from '@tanstack/react-query'
import type { RedactionRunStatus } from '@obiter/contracts'
import { apiFetch } from './api'

/** Shared with @obiter/redact-ui so list caches stay coherent. */
export const redactionRunsQueryKey = ['redaction-runs'] as const

/** List payload fields used by shell chrome (home / mode rail). */
export interface RedactionRunListItem {
  id: string
  sourceFilename: string
  status: RedactionRunStatus
  matterId: string | null
  matterName?: string | null
  createdAt: string
  updatedAt: string
  summary?: {
    totalSpans?: number
    reviewedCount?: number
    unreviewedCount?: number
    byDecision?: Partial<
      Record<
        | 'accept'
        | 'reject'
        | 'override_redact'
        | 'override_keep'
        | 'pseudonymise'
        | 'undecided',
        number
      >
    >
  }
}

/**
 * Lightweight redaction-run list for shell chrome (mode rail + home desk).
 * Same query key as redact-ui so opening Redact does not refetch from scratch.
 */
export function useRedactionRunsList(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: redactionRunsQueryKey,
    queryFn: () =>
      apiFetch<{ runs: RedactionRunListItem[] }>('/api/redaction-runs'),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}

/** Spans nobody has decided yet, or null when the summary does not say. */
export function undecidedSpanCount(
  summary: RedactionRunListItem['summary'],
): number | null {
  return summary?.byDecision?.undecided ?? summary?.unreviewedCount ?? null
}

/**
 * A run waiting on a person: one that failed, or one in review with a span
 * still undecided. The single definition the sidebar count and the Home queue
 * share, so the two can never disagree about what is pending. A run with every
 * span decided needs finalising, not a decision, so it belongs to Redact only.
 */
export function redactionRunNeedsDecision(
  run: Pick<RedactionRunListItem, 'status' | 'summary'>,
): boolean {
  switch (run.status) {
    case 'pending':
    case 'detecting':
    case 'finalized':
      return false
    case 'ready_for_review':
    case 'reviewing':
      return undecidedSpanCount(run.summary) !== 0
    case 'failed':
      return true
    default: {
      const unhandled: never = run.status
      throw new Error(`Unknown redaction run status: ${String(unhandled)}`)
    }
  }
}

export function attentionRunLabel(status: RedactionRunStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued'
    case 'detecting':
      return 'Detecting'
    case 'ready_for_review':
      return 'Ready for review'
    case 'reviewing':
      return 'In review'
    case 'failed':
      return 'Failed'
    case 'finalized':
      return 'Finalized'
    default:
      return status
  }
}
