import { useState } from 'react'
import { Check, X } from '@phosphor-icons/react'
import { Button } from '@obiter/ui'
import { labelledBreaks } from './inline-change-review'
import type { ReviewItem } from './review-items'
import { itemKindLabel, itemLead } from './review-items'

/**
 * The decision bar for one row. It is the fixed footer of the panel, so the
 * Accept and Reject for the row under review never scroll away from the row
 * itself, and every control here goes through the same review state the ribbon
 * and the row buttons use.
 */
export function ReviewDecisionBar({
  item,
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
  return (
    <div className="flex flex-col gap-2" aria-label="Decision bar">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-item text-ink">
          {lead ? (lead.author ?? 'Unknown author') : 'No change selected'}
          {item ? (
            <span className="ml-1 text-caption text-subtle">
              {itemKindLabel(item)}
            </span>
          ) : null}
        </p>
        <p className="shrink-0 text-caption text-subtle">
          {item
            ? `${String(position)} of ${String(total)}`
            : `0 of ${String(total)}`}
        </p>
      </div>
      <p className="text-caption break-words whitespace-pre-wrap text-muted">
        {reason ??
          (lead?.text
            ? labelledBreaks(lead.text)
            : lead
              ? 'Formatting change'
              : undefined)}
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!canPrevious || pending}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canNext || pending}
            onClick={onNext}
          >
            Next
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={onReject}
            iconStart={<X size={12} aria-hidden />}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={disabled}
            onClick={onAccept}
            iconStart={<Check size={12} aria-hidden />}
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The bulk bar. It states the exact number of changes a decision will affect
 * before it runs, and it can only ever hold tracked changes: the panel offers
 * no checkbox on a comment or on a move no decision can run on. Rejection asks
 * once more, because a decision writes an immutable version rather than
 * changing the one on screen.
 */
export function ReviewBulkBar({
  count,
  reason,
  onAccept,
  onReject,
  onClear,
}: {
  count: number
  /** Why the selection cannot be decided, or null when it can. */
  reason: string | null
  onAccept: () => void
  onReject: () => void
  onClear: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const label = count === 1 ? '1 change' : `${String(count)} changes`
  if (confirming) {
    return (
      <div className="flex flex-col gap-2" aria-label="Confirm rejection">
        <p className="text-caption text-ink" role="alert">
          Reject {label}? This writes a new version and cannot be undone.
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
