import { useState } from 'react'
import { Check, X } from '@phosphor-icons/react'
import { Button, KeyboardHint } from '@obiter/ui'
import { labelledBreaks } from './inline-change-review'
import type { ReviewItem } from './review-items'
import { itemKindLabel, itemLead } from './review-items'
import { reviewerStyle } from './reviewer-identity'

/**
 * The decision bar for one row. It is the fixed footer of the panel, so the
 * Accept and Reject for the row under review never scroll away from the row
 * itself, and every control here goes through the same review state the
 * chrome and the row buttons use.
 *
 * With no current row the bar names that state and offers navigation only:
 * an Accept that could not run reads as enabled whenever it is styled like one.
 */
export function ReviewDecisionBar({
  item,
  location,
  position,
  total,
  reason,
  pending,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onAccept,
  onReject,
}: {
  /** The row under review; absent until one is chosen. */
  item?: ReviewItem
  location?: string
  position: number
  total: number
  /** Why a decision cannot run on this row, or null when it can. */
  reason: string | null | undefined
  pending: boolean
  canPrevious: boolean
  canNext: boolean
  onPrevious: () => void
  onNext: () => void
  onAccept: () => void
  onReject: () => void
}) {
  const lead = item ? itemLead(item) : undefined
  const disabled = pending || !item || Boolean(reason)
  const style = reviewerStyle(lead?.author)
  return (
    <div className="flex flex-col gap-2" aria-label="Decision bar">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 truncate text-item text-ink">
          {lead ? (
            <>
              <span
                data-reviewer={style.slot}
                className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium ${style.surface} ${style.text}`}
                aria-hidden
              >
                {style.initials}
              </span>
              <span className="truncate">
                {lead.author ?? 'Unknown author'}
              </span>
              <span className="shrink-0 text-caption text-subtle">
                {itemKindLabel(item!)}
              </span>
            </>
          ) : (
            'No change selected'
          )}
        </p>
        <p className="shrink-0 text-caption text-subtle">
          {item
            ? `${String(position)} of ${String(total)}`
            : `0 of ${String(total)}`}
        </p>
      </div>
      {location ? (
        <p className="truncate text-caption text-subtle">{location}</p>
      ) : null}
      {/* The barrier reason belongs on the disabled controls, not in a
          second paragraph: the banner above the document already says what
          happened and offers Reload. */}
      <p className="text-caption break-words whitespace-pre-wrap text-muted">
        {lead?.text
          ? labelledBreaks(lead.text)
          : lead
            ? 'Formatting change'
            : 'Choose a change in the list, or use Next.'}
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canPrevious || pending}
            onClick={onPrevious}
          >
            Previous{' '}
            <span aria-hidden>
              <KeyboardHint>K</KeyboardHint>
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canNext || pending}
            onClick={onNext}
          >
            Next{' '}
            <span aria-hidden>
              <KeyboardHint>J</KeyboardHint>
            </span>
          </Button>
        </div>
        {item ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              title={reason ?? undefined}
              onClick={onReject}
              iconStart={<X size={12} aria-hidden />}
            >
              Reject{' '}
              <span aria-hidden>
                <KeyboardHint>R</KeyboardHint>
              </span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={disabled}
              title={reason ?? undefined}
              onClick={onAccept}
              iconStart={<Check size={12} aria-hidden />}
            >
              Accept{' '}
              <span aria-hidden>
                <KeyboardHint>A</KeyboardHint>
              </span>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The bulk bar. It states the exact number of changes a decision will affect
 * before it runs, and it can only ever hold tracked changes: the panel offers
 * no checkbox on a comment or on a move no decision can run on. Rejection asks
 * once more, because a decision writes an immutable version — and says what
 * that costs and keeps, with the version numbers rather than "cannot be
 * undone", which was not true: the earlier version stays available.
 */
export function ReviewBulkBar({
  count,
  versionNumber,
  reason,
  onAccept,
  onReject,
  onClear,
}: {
  count: number
  /** The version on screen; the decision saves the next one. */
  versionNumber?: number
  /** Why the selection cannot be decided, or null when it can. */
  reason: string | null
  onAccept: () => void
  onReject: () => void
  onClear: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const label = count === 1 ? '1 change' : `${String(count)} changes`
  if (confirming) {
    const next = (versionNumber ?? 1) + 1
    return (
      <div className="flex flex-col gap-2" aria-label="Confirm rejection">
        <p className="text-caption text-ink" role="alert">
          Reject {label}? This saves version {next}. Version {next - 1} stays
          available.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={Boolean(reason)}
            onClick={() => {
              setConfirming(false)
              onReject()
            }}
            iconStart={<X size={12} aria-hidden />}
          >
            Reject {label}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2" aria-label="Bulk decision">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-ink">{label} selected</p>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Clear selection"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      {reason ? (
        <p className="text-caption text-muted" role="note">
          {reason}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(reason)}
          onClick={() => setConfirming(true)}
          iconStart={<X size={12} aria-hidden />}
        >
          Reject {label}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(reason)}
          onClick={onAccept}
          iconStart={<Check size={12} aria-hidden />}
        >
          Accept {label}
        </Button>
      </div>
    </div>
  )
}
