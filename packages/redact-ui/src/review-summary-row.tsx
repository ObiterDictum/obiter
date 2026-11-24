import { ProgressBar, StatusDot } from '@obiter/ui'
import type { SpanCategory } from '@obiter/contracts'
import type { RedactionRun } from './types'
import { CategoryLegend } from './review-document-text'

export function ReviewSummaryRow({
  run,
  counts,
  categories,
  pageCount,
}: {
  run: RedactionRun
  counts: Record<'accepted' | 'rejected' | 'pseudonymised' | 'pending', number>
  categories: SpanCategory[]
  pageCount: number | null
}) {
  const decidedCount = run.summary.totalSpans - counts.pending
  const progress =
    run.summary.totalSpans === 0
      ? 100
      : (decidedCount / run.summary.totalSpans) * 100
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-12 py-3 @max-pane:px-8">
      <p className="text-meta text-muted">
        <span className="text-ink">
          {`${String(decidedCount)} of ${String(run.summary.totalSpans)} detected spans decided`}
        </span>
      </p>
      <ProgressBar
        value={progress}
        className="max-w-[200px] min-w-[120px] flex-1 @max-pane:hidden"
      />
      <p className="text-caption text-subtle" role="status">
        {counts.pending > 0
          ? `${counts.pending} left`
          : run.replacementRunId
            ? null
            : 'All spans decided. Choose Finalise to continue.'}
      </p>
      <div className="@max-pane:hidden">
        <CategoryLegend categories={categories} />
      </div>
      <div className="ml-auto flex items-center gap-4 @max-pane:hidden">
        <span className="flex items-center gap-4 text-caption text-muted">
          <StatusDot tone="success">
            {`Redacted ${String(counts.accepted)}`}
          </StatusDot>
          <StatusDot tone="neutral">
            {`Kept visible ${String(counts.rejected)}`}
          </StatusDot>
          <StatusDot tone="warning">
            {`Needs review ${String(counts.pending)}`}
          </StatusDot>
        </span>
        {pageCount === null ? null : (
          <span className="text-caption text-subtle">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </span>
        )}
      </div>
    </div>
  )
}
