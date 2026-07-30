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

const ATTENTION_STATUSES = new Set<RedactionRunStatus>([
  'pending',
  'detecting',
  'ready_for_review',
  'reviewing',
  'failed',
])

export function isAttentionRun(status: RedactionRunStatus) {
  return ATTENTION_STATUSES.has(status)
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
