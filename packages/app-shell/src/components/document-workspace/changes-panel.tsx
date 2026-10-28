import { useState } from 'react'
import { Check, X } from '@phosphor-icons/react'
import { Button, DockedPanel, EmptyState, cn } from '@obiter/ui'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentChangeWire,
} from '@obiter/contracts'
import { formatDateTime } from '../../format'
import { SegmentedControl } from '../../segmented-control'
import type { ChangeReview } from './use-change-review'
import { labelledBreaks } from './inline-change-review'
import {
  itemChangeIds,
  itemDecidable,
  itemKindLabel,
  itemLead,
  reviewCounts,
  reviewCountsLabel,
  reviewItems,
  type ReviewItem,
} from './review-items'
import { ReviewBulkBar, ReviewDecisionBar } from './review-bars'

type Filter = 'all' | 'change' | 'move'

/**
 * The review panel: tracked changes and the moves no decision can run on, with
 * the decision bar fixed beneath them. It is presentation and wiring over
 * `useChangeReview` — deciding, the save barriers and the request are the
 * existing review state's, so the panel and the ribbon can never disagree
 * about what a decision means right now.
 *
 * Selection lives here and nowhere else: it holds row ids, never comment ids,
 * and a bulk decision sends the wire ids of the decidable rows it names.
 */
export function DocumentReviewPanel({
  review,
  commentCount,
  onClose,
}: {
  review: ChangeReview
  /** Threads in the document; the panel reports them, it does not decide them. */
  commentCount: number
  onClose: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const items = reviewItems(review.changes)
  const counts = reviewCounts(items)
  // An undecidable move is pinned above the list: it is the one row a reader
  // must look at by hand, and burying it among the changes hides the work.
  const pinned = items.filter(
    (item) => item.kind === 'move' && !itemDecidable(item),
  )
  const ordered = [...pinned, ...items.filter((item) => !pinned.includes(item))]
  const visible = ordered
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => filter === 'all' || item.kind === filter)
  const activeIndex = ordered.findIndex((item) =>
    itemChangeIds(item).includes(review.activeChangeId ?? ''),
  )
  // Decided rows leave `items`, so a stale id in the selection can no longer
  // reach a decision: the selection is read through the rows that still exist.
  const selectedItems = ordered.filter(
    (item) => selected.has(item.id) && itemDecidable(item),
  )
  const selectedIds = selectedItems.flatMap(itemChangeIds)
  const selectionReason =
    review.unavailable ??
    (selectedIds.length > TRACKED_DECISION_MAX_IDS
      ? `More than ${String(TRACKED_DECISION_MAX_IDS)} changes must be decided in smaller groups.`
      : null)
  const decideBlocked = review.pending || Boolean(review.unavailable)
  const barrierNoteId = 'changes-review-unavailable'
  const lead = activeIndex >= 0 ? ordered[activeIndex] : undefined

  function toggle(item: ReviewItem) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  // Item indexes and change indexes diverge — one row can hold several wire ids
  // — so navigation goes through the row's leading revision.
  function goToItem(index: number) {
    const item = ordered[index]
    if (!item) return
    const id = itemLead(item).id
    review.goTo(review.changes.findIndex((change) => change.id === id))
  }

  function decideSelected(action: 'accept' | 'reject') {
    review.decideSelected(action, selectedIds)
  }

  function decideCurrent(action: 'accept' | 'reject') {
    if (!lead) return
    review.decideChange(action, itemLead(lead))
  }

  return (
    <DockedPanel
      title="Changes and comments"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          {selectedItems.length > 0 ? (
            <ReviewBulkBar
              // The count is rows — what the reader selected. A paired move is
              // one change there, though the request names both its halves.
              count={selectedItems.length}
              reason={selectionReason}
              onAccept={() => decideSelected('accept')}
              onReject={() => decideSelected('reject')}
              onClear={() => setSelected(new Set())}
            />
          ) : null}
          <ReviewDecisionBar
            item={lead}
            position={activeIndex + 1}
            total={ordered.length}
            // The bar carries the shared single-change reason, so a control
            // that cannot run shows why rather than sitting there disabled.
            reason={lead ? review.targetUnavailable : null}
            pending={review.pending}
            canPrevious={activeIndex > 0}
            canNext={
              activeIndex < 0
                ? ordered.length > 0
                : activeIndex < ordered.length - 1
            }
            onPrevious={() => goToItem(activeIndex - 1)}
            onNext={() => goToItem(activeIndex + 1)}
            onAccept={() => decideCurrent('accept')}
            onReject={() => decideCurrent('reject')}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">
            {reviewCountsLabel(counts, commentCount)}
          </p>
          {counts.moves > 0 || counts.changes > 0 ? (
            <SegmentedControl<Filter>
              label="Filter changes and moves"
              value={filter}
              // A filter that hid a selected row would let a bulk decision run
              // on something the reader cannot see, so changing it clears the
              // selection rather than warning about it.
              onChange={(next) => {
                setFilter(next)
                setSelected(new Set())
              }}
              options={[
                { value: 'all', label: `All ${String(ordered.length)}` },
                ...(counts.changes > 0
                  ? [
                      {
                        value: 'change' as const,
                        label: `Changes ${String(counts.changes)}`,
                      },
                    ]
                  : []),
                ...(counts.moves > 0
                  ? [
                      {
                        value: 'move' as const,
                        label: `Moves ${String(counts.moves)}`,
                      },
                    ]
                  : []),
              ]}
            />
          ) : null}
        </div>
        {review.unavailable ? (
          <p
            id={barrierNoteId}
            className="text-caption text-muted"
            role="status"
          >
            {review.unavailable}
          </p>
        ) : null}
        {review.error ? (
          <p className="text-caption text-danger" role="alert">
            The decision was not saved. {review.error}
          </p>
        ) : null}
        {counts.undecidable > counts.manualMoves ? (
          <p className="text-caption text-muted" role="note">
            {counts.undecidable - counts.manualMoves === 1
              ? 'One listed change cannot be decided here; it stays listed and unchanged in the document.'
              : `${String(counts.undecidable - counts.manualMoves)} listed changes cannot be decided here; they stay listed and unchanged in the document.`}
          </p>
        ) : null}
        {commentCount > 0 ? (
          <p className="text-caption text-muted max-compact:hidden">
            {commentCount === 1
              ? 'One comment thread is read and resolved in the Comments panel.'
              : `${String(commentCount)} comment threads are read and resolved in the Comments panel.`}
          </p>
        ) : null}
        {review.changes.length === 0 ? (
          <EmptyState
            title="No tracked changes"
            body="Edits saved with tracking on appear here with their author and date."
          />
        ) : visible.length === 0 ? (
          <p className="text-caption text-muted">No rows match this filter.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map(({ item, index }) => {
              const isActive = index === activeIndex
              const change = item.kind === 'change' ? item.change : undefined
              const undecidableReason = change
                ? review.undecidableReason(change)
                : itemDecidable(item)
                  ? undefined
                  : 'This move cannot be decided here; it stays listed and unchanged in the document.'
              const noteId = `review-item-${item.id}`
              const describedBy =
                [
                  undecidableReason ? noteId : null,
                  decideBlocked ? barrierNoteId : null,
                ]
                  .filter((id): id is string => id !== null)
                  .join(' ') || undefined
              return (
                <li
                  key={item.id}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'flex gap-2 border-t border-line py-3 first:border-t-0',
                    isActive && 'rounded-md bg-raised px-2',
                    item.kind === 'move' &&
                      !itemDecidable(item) &&
                      'bg-warning-soft px-2',
                  )}
                >
                  <div className="flex w-5 shrink-0 items-start justify-center pt-0.5">
                    {itemDecidable(item) ? (
                      <input
                        type="checkbox"
                        className="size-3.5 accent-brand"
                        checked={selected.has(item.id)}
                        aria-label={`Select the ${itemKindLabel(item).toLowerCase()} by ${itemLead(item).author ?? 'an unknown author'}`}
                        onChange={() => toggle(item)}
                      />
                    ) : null}
                  </div>
                  <span
                    aria-hidden="true"
                    className="w-4 shrink-0 text-caption tabular-nums text-subtle"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <button
                      type="button"
                      className="flex flex-col gap-1 text-left"
                      aria-label={
                        isActive ? 'Current change' : 'Show this change'
                      }
                      onClick={() => goToItem(index)}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-item text-ink">
                          {itemLead(item).author ?? 'Unknown author'}
                        </span>
                        <span className="shrink-0 text-caption text-subtle">
                          {itemDate(item)}
                        </span>
                      </span>
                      <span className="text-caption text-subtle">
                        {itemKindLabel(item)}
                      </span>
                      <ReviewText item={item} />
                    </button>
                    {undecidableReason ? (
                      <p
                        id={noteId}
                        className="text-caption text-muted"
                        role="note"
                      >
                        {/* At 1024 the pinned explanation, the list and the two
                            bars share 768px of height, so the note keeps its
                            first sentence there and the full one above. */}
                        <span className="max-compact:hidden">
                          {undecidableReason}
                        </span>
                        <span className="hidden max-compact:inline">
                          {compactNote(undecidableReason)}
                        </span>
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={decideBlocked || Boolean(undecidableReason)}
                        aria-describedby={describedBy}
                        onClick={() =>
                          review.decideChange('reject', itemLead(item))
                        }
                        iconStart={<X size={12} aria-hidden />}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={decideBlocked || Boolean(undecidableReason)}
                        aria-describedby={describedBy}
                        onClick={() =>
                          review.decideChange('accept', itemLead(item))
                        }
                        iconStart={<Check size={12} aria-hidden />}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DockedPanel>
  )
}

/** The note's first clause: at 1024 the rail has room for one line. */
function compactNote(reason: string) {
  const [first = reason] = reason.split(/[.;]/u)
  return `${first}.`
}

function itemDate(item: ReviewItem) {
  const date = itemLead(item).date
  return date ? formatDateTime(date) : 'No date'
}

/** The change itself, marked the way the page marks it: a deletion struck, an
 * insertion underlined, a move by the side it came from or arrived at. */
function ReviewText({ item }: { item: ReviewItem }) {
  const change: DocumentChangeWire = itemLead(item)
  if (item.kind === 'move' && item.members.length > 1)
    return <MoveText change={change} />
  if (!change.text) {
    return <span className="text-body text-muted">Property change</span>
  }
  const deleted =
    change.kind === 'delete' ||
    (change.kind === 'move' && change.direction === 'from')
  return (
    <span
      className={cn(
        'text-body break-words whitespace-pre-wrap',
        deleted ? 'text-danger line-through' : 'text-success underline',
      )}
    >
      {labelledBreaks(change.text)}
    </span>
  )
}

/** A paired move reads as one line: the text that travelled. */
function MoveText({ change }: { change: DocumentChangeWire }) {
  return (
    <span className="text-body break-words whitespace-pre-wrap text-ink">
      <span className="text-muted">Moved: </span>
      {labelledBreaks(change.text)}
    </span>
  )
}
