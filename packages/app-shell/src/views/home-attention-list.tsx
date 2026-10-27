import { Link } from '@tanstack/react-router'
import { ArrowRight, Flag, PencilSimple, Warning } from '@phosphor-icons/react'
import { Skeleton, StatusDot, buttonClassName, cn } from '@obiter/ui'
import { useVerificationFindings } from '../verification-runs'
import type { AttentionItem, VerificationAttentionItem } from './home-attention'
import {
  attentionExplanation,
  attentionMeta,
  attentionReason,
  attentionStatus,
  attentionTitle,
  topUnresolvedFinding,
} from './home-attention-copy'

/** The mock-up shows the queue at a glance; the module pages hold the rest. */
export const ATTENTION_LIMIT = 5

export function AttentionSection({
  items,
  total,
  loading,
  error,
}: {
  /** Ranked and already sliced to {@link ATTENTION_LIMIT}. */
  items: AttentionItem[]
  /** How many ranked items exist, including the ones not shown. */
  total: number
  loading: boolean
  error: string | null
}) {
  const meta =
    total > items.length
      ? `Ranked by legal risk, then by time waiting · showing ${items.length} of ${total}`
      : 'Ranked by legal risk, then by time waiting'

  return (
    <section aria-labelledby="attention">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="attention" className="text-section text-ink">
          Needs your attention
        </h2>
        <span className="text-meta text-subtle">{meta}</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <span className="sr-only">Loading your open work…</span>
        </div>
      ) : error ? (
        <p className="rounded-lg bg-surface p-6 text-body text-muted">
          Your open work could not be loaded. {error}
        </p>
      ) : (
        <div className="rounded-lg bg-surface">
          {items.length === 0 ? (
            <p className="px-6 py-8 text-body text-muted">
              No Verify findings, redaction decisions or failed runs are
              waiting.
            </p>
          ) : (
            <ol className="list-none" role="list">
              {items.map((item, index) => (
                <AttentionRow key={item.id} item={item} rank={index + 1} />
              ))}
            </ol>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-3 text-caption">
            <Link
              to="/verify"
              className="inline-flex items-center gap-1 text-muted hover:text-ink"
            >
              All Verify findings <ArrowRight size={12} aria-hidden />
            </Link>
            <Link
              to="/redact"
              className="inline-flex items-center gap-1 text-muted hover:text-ink"
            >
              All redaction runs <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

function AttentionRow({ item, rank }: { item: AttentionItem; rank: number }) {
  const status = attentionStatus(item)
  return (
    <li
      className={cn(
        'grid grid-cols-[16px_32px_minmax(0,1fr)] gap-4 p-6',
        '[&+li]:border-t [&+li]:border-line',
      )}
    >
      <span
        className="pt-2 text-right text-meta text-subtle tabular-nums"
        aria-hidden="true"
      >
        {rank}
      </span>
      <span
        className={cn(
          'grid size-8 place-items-center rounded-sm',
          item.kind === 'redact_decision'
            ? 'bg-info-soft text-info'
            : status.tone === 'warning'
              ? 'bg-warning-soft text-warning'
              : 'bg-danger-soft text-danger',
        )}
        aria-hidden="true"
      >
        <AttentionIcon item={item} />
      </span>
      <div className="min-w-0">
        <p className="text-caption text-muted">{attentionReason(item)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="text-item text-ink">{attentionTitle(item)}</h3>
          <StatusDot tone={status.tone}>{status.label}</StatusDot>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-meta text-subtle">
          {item.filename ? (
            <span className="text-muted">{item.filename}</span>
          ) : null}
          {item.matterName && item.matterId ? (
            <>
              <Sep />
              <Link
                to="/matters/$matterId"
                params={{ matterId: item.matterId }}
                className="text-muted hover:text-ink"
              >
                {item.matterName}
              </Link>
            </>
          ) : null}
          {item.matterReference ? (
            <>
              <Sep />
              <span className="font-mono">{item.matterReference}</span>
            </>
          ) : null}
        </p>
        <AttentionExplanation item={item} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <span className="text-meta text-subtle">{attentionMeta(item)}</span>
          <AttentionAction item={item} />
        </div>
      </div>
    </li>
  )
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-subtle">
      ·
    </span>
  )
}

function AttentionIcon({ item }: { item: AttentionItem }) {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
    case 'verify_review':
      return <Flag size={16} />
    case 'redact_decision':
      return <PencilSimple size={16} />
    case 'verify_failed':
    case 'redact_failed':
      return <Warning size={16} />
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

function AttentionExplanation({ item }: { item: AttentionItem }) {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
    case 'verify_review':
      return <VerificationExplanation item={item} />
    case 'redact_decision':
    case 'verify_failed':
    case 'redact_failed':
      return (
        <p className="mt-2 max-w-[68ch] text-body text-muted">
          {attentionExplanation(item)}
        </p>
      )
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

/**
 * The findings endpoint is per run, so the row explains the run it names rather
 * than guessing from counts. Same cache entry the document page reads, so
 * opening the finding does not fetch it twice.
 */
function VerificationExplanation({
  item,
}: {
  item: VerificationAttentionItem
}) {
  const findings = useVerificationFindings(item.runId)
  return (
    <p className="mt-2 max-w-[68ch] text-body text-muted">
      {attentionExplanation(item, topUnresolvedFinding(findings.findings))}
    </p>
  )
}

function AttentionAction({ item }: { item: AttentionItem }) {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
      return (
        <Link
          to="/matters/$matterId/documents/$documentId"
          params={{ matterId: item.matterId, documentId: item.documentId }}
          className={buttonClassName({ variant: 'primary', size: 'sm' })}
        >
          Review finding
        </Link>
      )
    case 'verify_review':
    case 'verify_failed':
      return (
        <Link
          to="/matters/$matterId/documents/$documentId"
          params={{ matterId: item.matterId, documentId: item.documentId }}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          {kind === 'verify_review' ? 'Review findings' : 'Open document'}
        </Link>
      )
    case 'redact_decision':
      return (
        <Link
          to="/redact/$runId"
          params={{ runId: item.runId }}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Continue review
        </Link>
      )
    case 'redact_failed':
      return (
        <Link
          to="/redact/$runId"
          params={{ runId: item.runId }}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Open run
        </Link>
      )
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}
