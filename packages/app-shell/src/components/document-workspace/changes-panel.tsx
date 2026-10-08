import { Button, EmptyState, cn } from '@obiter/ui'
import type { ChangeReview } from './use-change-review'

export function DocumentChangesPanel({ review }: { review: ChangeReview }) {
  const { changes } = review
  const decideBlocked = review.pending || Boolean(review.unavailable)
  return (
    <aside
      className="flex w-full flex-col gap-5 lg:max-w-sm"
      aria-label="Tracked changes"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Tracked changes</h3>
          {changes.length > 0 ? (
            <p className="font-mono text-[11px] text-subtle">
              {review.activeIndex >= 0 ? review.activeIndex + 1 : '—'} of{' '}
              {changes.length}
            </p>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Accept or reject a change to write a new immutable version.
        </p>
        {changes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!review.canPrevious}
              onClick={review.goToPrevious}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!review.canNext}
              onClick={review.goToNext}
            >
              Next
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={review.pending || Boolean(review.bulkUnavailable)}
              onClick={() => review.decideAll('accept')}
            >
              Accept all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={review.pending || Boolean(review.bulkUnavailable)}
              onClick={() => review.decideAll('reject')}
            >
              Reject all
            </Button>
          </div>
        ) : null}
        {changes.length > 0 && review.bulkUnavailable ? (
          <p className="text-xs leading-relaxed text-muted" role="note">
            {review.bulkUnavailable}
          </p>
        ) : null}
      </div>
      {review.error ? (
        <p className="text-sm text-danger" role="alert">
          {review.error}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <EmptyState
          title="No tracked changes"
          body="Edits saved with tracking on appear here with their author and date."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {changes.map((change, index) => {
            const isActive = index === review.activeIndex
            return (
              <li
                key={change.id}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-2 border-t border-line pt-3',
                  isActive && 'rounded-md bg-raised p-2 ring-1 ring-line',
                )}
              >
                <button
                  type="button"
                  className="flex flex-col gap-2 text-left"
                  aria-label={isActive ? 'Current change' : 'Show this change'}
                  onClick={() => review.goTo(index)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {change.author ?? 'Unknown author'}
                    </p>
                    <p className="font-mono text-[11px] text-subtle">
                      {change.date
                        ? new Date(change.date).toLocaleString()
                        : 'No date'}
                    </p>
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
                    {change.kind}
                    {change.elementName ? ` · ${change.elementName}` : ''}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {change.text || 'Property change'}
                  </p>
                </button>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decideBlocked}
                    onClick={() => review.decideChange('accept', change)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={decideBlocked}
                    onClick={() => review.decideChange('reject', change)}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
