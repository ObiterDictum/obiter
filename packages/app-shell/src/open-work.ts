import type { VerificationRun } from '@obiter/contracts'
import {
  redactionRunNeedsDecision,
  type RedactionRunListItem,
} from './redaction-runs'

export function latestRunsPerDocument(
  runs: readonly VerificationRun[],
): VerificationRun[] {
  const newest = new Map<string, VerificationRun>()
  for (const run of runs) {
    const seen = newest.get(run.documentId)
    if (!seen || startedAt(run) > startedAt(seen)) {
      newest.set(run.documentId, run)
    }
  }
  return [...newest.values()]
}

function startedAt(run: VerificationRun) {
  return Date.parse(run.completedAt ?? run.createdAt) || 0
}

export function attentionRunsPerDocument(
  runs: readonly VerificationRun[],
): VerificationRun[] {
  const completed = new Map<string, VerificationRun>()
  for (const run of runs) {
    if (run.status !== 'completed') continue
    const seen = completed.get(run.documentId)
    if (!seen || startedAt(run) > startedAt(seen)) {
      completed.set(run.documentId, run)
    }
  }
  return latestRunsPerDocument(runs).flatMap((run) => {
    const listed = completed.get(run.documentId)
    if (!listed || listed.id === run.id) return [run]
    return run.status === 'failed' ? [listed, run] : [listed]
  })
}

export function openWorkForRun(run: VerificationRun): number {
  switch (run.status) {
    case 'queued':
    case 'running':
      return 0
    case 'failed':
      return 1
    case 'completed':
      return (
        run.summary.flaggedCount +
        run.summary.reviewRequiredCount +
        run.summary.notCheckedCount
      )
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}

export interface OpenWork {
  verify: number
  redact: number
  total: number
}

export function openWorkCount(sources: {
  verificationRuns: readonly VerificationRun[]
  redactionRuns: readonly RedactionRunListItem[]
}): OpenWork {
  const verify = attentionRunsPerDocument(sources.verificationRuns).reduce(
    (total, run) => total + openWorkForRun(run),
    0,
  )
  const redact = sources.redactionRuns.filter(redactionRunNeedsDecision).length
  return { verify, redact, total: verify + redact }
}
