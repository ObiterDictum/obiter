import type {
  VerificationFailureCode,
  VerificationRun,
} from '@obiter/contracts'
import type { RedactionRunListItem } from '../redaction-runs'

/**
 * Anything on Home that is waiting for a person, assembled from the endpoints
 * the shell already reads. Kept free of React so the ranking and the copy can
 * be tested without a renderer.
 */
type AttentionKind =
  | 'verify_flagged'
  | 'verify_review'
  | 'redact_decision'
  | 'verify_failed'
  | 'redact_failed'

/**
 * Triage order, risk first: a citation that may make the document wrong, then
 * a disclosure decision that blocks finalising, then a citation only a person
 * can judge, then work that stopped. The review asked each row to say why it
 * sits where it does (`REVIEW-professional.md` [10]), so this order is the
 * reason line, not an opaque score.
 */
const RISK_ORDER = {
  verify_flagged: 0,
  redact_decision: 1,
  verify_review: 2,
  verify_failed: 3,
  redact_failed: 3,
} satisfies Record<AttentionKind, number>

interface AttentionBase {
  runId: string
  matterId: string | null
  matterName: string | null
  matterReference: string | null
  /** Null until the document it names has been read. */
  filename: string | null
  /** When it started waiting, ISO. Within a risk tier the oldest wait is first. */
  waitingSince: string
}

export type VerificationAttentionItem = AttentionBase & {
  /** Stable across a refresh: the kind plus the run it came from. */
  id: string
  kind: 'verify_flagged' | 'verify_review' | 'verify_failed'
  matterId: string
  documentId: string
  flaggedCount: number
  reviewRequiredCount: number
  failureCode: VerificationFailureCode | null
}

type RedactionAttentionItem = AttentionBase & {
  id: string
  kind: 'redact_decision' | 'redact_failed'
  undecidedCount: number | null
  totalSpans: number | null
  redactedCount: number | null
  keptCount: number | null
}

export type AttentionItem = VerificationAttentionItem | RedactionAttentionItem

export interface AttentionSources {
  verificationRuns: VerificationRun[]
  redactionRuns: RedactionRunListItem[]
  /** documentId → filename, from the document boundary the run list lacks. */
  documentFilenames: Map<string, string>
  /** matterId → the matter record, for the name and client reference. */
  matters: Map<string, { name: string; clientReference: string }>
}

export function buildAttentionItems(
  sources: AttentionSources,
): AttentionItem[] {
  return [
    ...sources.verificationRuns.flatMap((run) =>
      verificationAttentionItem(run, sources),
    ),
    ...sources.redactionRuns.flatMap((run) =>
      redactionAttentionItem(run, sources),
    ),
  ]
}

/** A run still detecting is work in progress, not a decision waiting. */
function verificationAttentionItem(
  run: VerificationRun,
  sources: AttentionSources,
): AttentionItem[] {
  const matter = sources.matters.get(run.matterId)
  const base: AttentionBase = {
    runId: run.id,
    matterId: run.matterId,
    matterName: matter?.name ?? null,
    matterReference: matter?.clientReference || null,
    filename: sources.documentFilenames.get(run.documentId) ?? null,
    waitingSince: run.completedAt ?? run.createdAt,
  }
  switch (run.status) {
    case 'queued':
    case 'running':
      return []
    case 'completed': {
      const { flaggedCount, reviewRequiredCount } = run.summary
      if (flaggedCount === 0 && reviewRequiredCount === 0) return []
      return [
        {
          ...base,
          id: `verify:${run.id}`,
          matterId: run.matterId,
          kind: flaggedCount > 0 ? 'verify_flagged' : 'verify_review',
          documentId: run.documentId,
          flaggedCount,
          reviewRequiredCount,
          failureCode: null,
        },
      ]
    }
    case 'failed':
      return [
        {
          ...base,
          id: `verify:${run.id}`,
          matterId: run.matterId,
          kind: 'verify_failed',
          documentId: run.documentId,
          flaggedCount: run.summary.flaggedCount,
          reviewRequiredCount: run.summary.reviewRequiredCount,
          failureCode: run.failureCode,
        },
      ]
    default: {
      const unhandled: never = run.status
      throw new Error(`Unknown verification run status: ${String(unhandled)}`)
    }
  }
}

function redactionAttentionItem(
  run: RedactionRunListItem,
  sources: AttentionSources,
): AttentionItem[] {
  const matter = run.matterId ? sources.matters.get(run.matterId) : undefined
  const base: AttentionBase = {
    runId: run.id,
    matterId: run.matterId,
    matterName: run.matterName ?? matter?.name ?? null,
    matterReference: matter?.clientReference || null,
    filename: run.sourceFilename,
    waitingSince: run.updatedAt,
  }
  const decisions = run.summary?.byDecision
  const undecidedCount =
    decisions?.undecided ?? run.summary?.unreviewedCount ?? null
  const counts = {
    undecidedCount,
    totalSpans: run.summary?.totalSpans ?? null,
    redactedCount:
      decisions === undefined
        ? null
        : (decisions.accept ?? 0) + (decisions.override_redact ?? 0),
    keptCount:
      decisions === undefined
        ? null
        : (decisions.reject ?? 0) + (decisions.override_keep ?? 0),
  }
  switch (run.status) {
    case 'pending':
    case 'detecting':
    // Finalised output is done; a run at zero undecided spans needs finalising,
    // not a legal decision, so it belongs to Redact rather than this queue.
    case 'finalized':
      return []
    case 'ready_for_review':
    case 'reviewing':
      if (undecidedCount === 0) return []
      return [
        {
          ...base,
          ...counts,
          id: `redact:${run.id}`,
          kind: 'redact_decision',
        },
      ]
    case 'failed':
      return [
        { ...base, ...counts, id: `redact:${run.id}`, kind: 'redact_failed' },
      ]
    default: {
      const unhandled: never = run.status
      throw new Error(`Unknown redaction run status: ${String(unhandled)}`)
    }
  }
}

/** Risk first, then the longest wait, then the id so a tie never jitters. */
export function rankAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const risk = RISK_ORDER[a.kind] - RISK_ORDER[b.kind]
    if (risk !== 0) return risk
    const wait = waitTime(a.waitingSince) - waitTime(b.waitingSince)
    if (wait !== 0) return wait
    return a.id.localeCompare(b.id)
  })
}

/** An unreadable timestamp ranks as newest: it must not jump the queue. */
function waitTime(iso: string) {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

export interface AttentionSummary {
  total: number
  flagged: number
  redactDecisions: number
  reviews: number
  failed: number
}

export function summariseAttention(items: AttentionItem[]): AttentionSummary {
  const summary: AttentionSummary = {
    total: items.length,
    flagged: 0,
    redactDecisions: 0,
    reviews: 0,
    failed: 0,
  }
  for (const item of items) {
    const kind = item.kind
    switch (kind) {
      case 'verify_flagged':
        summary.flagged += 1
        break
      case 'verify_review':
        summary.reviews += 1
        break
      case 'redact_decision':
        summary.redactDecisions += 1
        break
      case 'verify_failed':
      case 'redact_failed':
        summary.failed += 1
        break
      default: {
        const unhandled: never = kind
        return unhandled
      }
    }
  }
  return summary
}
