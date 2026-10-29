import type { VerificationRun } from '@obiter/contracts'
import {
  redactionRunNeedsDecision,
  type RedactionRunListItem,
} from './redaction-runs'

/**
 * Open work: the one rule behind the sidebar badges, the Home header, the Home
 * queue and a matter's "Open work". Counting is a claim about how much is
 * waiting on a person, so it is defined once and every surface reads it rather
 * than each inventing a total that then disagrees with the others.
 */

/**
 * The newest run per document. Verify lists one document once, and a re-run
 * answers the same question as the run before it, so the newest replaces the
 * earlier count instead of adding to it. The list arrives newest first; the
 * sort makes the rule independent of that.
 */
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

/**
 * What one document's run leaves waiting. A completed run counts its open
 * findings: dismissed findings are already outside the summary's counts, so a
 * decision once taken stops being work. A run that stopped counts once,
 * because the version it was bound to has not been checked at all — and its
 * findings, if it has any, are not a result anybody may rely on.
 */
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

/** Open work across the organisation: findings on each document's newest run,
 * plus a run of either kind that stopped, plus every redaction run waiting on
 * a decision. */
export function openWorkCount(sources: {
  verificationRuns: readonly VerificationRun[]
  redactionRuns: readonly RedactionRunListItem[]
}): OpenWork {
  const verify = latestRunsPerDocument(sources.verificationRuns).reduce(
    (total, run) => total + openWorkForRun(run),
    0,
  )
  const redact = sources.redactionRuns.filter(redactionRunNeedsDecision).length
  return { verify, redact, total: verify + redact }
}
