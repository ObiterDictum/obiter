import { useState } from 'react'
import { Check, ChatText, X } from '@phosphor-icons/react'
import {
  Badge,
  Button,
  DockedPanel,
  EmptyState,
  cn,
  type PanelPopout,
} from '@obiter/ui'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentComment,
  type DocumentImportedCommentThread,
  type DocumentModelWire,
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
  type ReviewItem,
} from './review-items'
import {
  changedWords,
  reviewRows,
  rowMatchesFilter,
  type ReviewFilter,
  type ReviewRow,
} from './review-list'
import { reviewerStyle } from './reviewer-identity'
import { ReviewBulkBar, ReviewDecisionBar } from './review-bars'

/**
 * The review panel: tracked changes, moves and comment threads in one list, in
 * document order, with the decision bar for the row under review. It is
 * presentation and wiring over `useChangeReview` — deciding, the save barriers
 * and the request are that state's, so the panel and the chrome cannot
 * disagree about what a decision means right now.
 *
 * Selection lives here and nowhere else: it holds row ids of decidable rows,
 * and a bulk decision sends the wire ids of the rows it names.
 */
export function DocumentReviewPanel({
  review,
  comments,
  importedComments,
  model,
  currentVersionNumber,
  onRevealComment,
  onClose,
  popout,
}: {
  review: ChangeReview
  comments: DocumentComment[]
  importedComments: DocumentImportedCommentThread[]
  /** The model the locations and context lines are read from. */
  model?: DocumentModelWire
  /** The version on screen, named by the bulk rejection's warning. */
  currentVersionNumber?: number
  onRevealComment: (comment: DocumentComment) => void
  onClose: () => void
  popout?: PanelPopout
}) {
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const rows = reviewRows({
    model,
    changes: review.changes,
    comments,
    importedComments,
  })
  const counts = reviewCounts(
    rows.filter((row) => row.kind === 'change').map((row) => row.item),
  )
  const commentCount = rows.filter((row) => row.kind === 'comment').length
  const visible = rows.filter((row) => rowMatchesFilter(row, filter))
  const activeIndex = rows.findIndex(
    (row) =>
      row.kind === 'change' &&
      itemChangeIds(row.item).includes(review.activeChangeId ?? ''),
  )
  const active = activeIndex >= 0 ? rows[activeIndex] : undefined
  // Decided rows leave the list, so a stale id in the selection can no longer
  // reach a decision: the selection is read through the rows that still exist.
  const selectedItems = rows.filter(
    (row) =>
      row.kind === 'change' &&
      row.item &&
      selected.has(row.id) &&
      itemDecidable(row.item),
  )
  const selectedIds = selectedItems.flatMap((row) =>
    row.kind === 'change' ? itemChangeIds(row.item) : [],
  )
  const selectionReason =
    review.unavailable ??
    (selectedIds.length > TRACKED_DECISION_MAX_IDS
      ? `More than ${String(TRACKED_DECISION_MAX_IDS)} changes must be decided in smaller groups.`
      : null)
  const decideBlocked = review.pending || Boolean(review.unavailable)
  const barrierNoteId = 'changes-review-unavailable'
  const bulkActive = selectedItems.length > 0

  function toggle(row: ReviewRow) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  /** Selecting a row reveals it in the document. */
  function goToRow(row: ReviewRow) {
    if (row.kind === 'comment') {
      if (row.imported) return
      const comment = row.comment
      // SAFETY: reviewRows sets `imported` false only for product comments,
      // which are the only ones with an anchor the workspace can reveal.
      onRevealComment(comment as DocumentComment)
      return
    }
    const id = itemLead(row.item).id
    const index = review.changes.findIndex((change) => change.id === id)
    if (index >= 0) review.goTo(index)
  }

  /** Moves the review to the next row that can be decided or read. */
  function step(direction: -1 | 1) {
    const from =
      activeIndex >= 0 ? activeIndex : direction === 1 ? -1 : rows.length
    for (
      let index = from + direction;
      index >= 0 && index < rows.length;
      index += direction
    ) {
      const row = rows[index]
      if (!row) continue
      if (row.kind === 'change' && !itemDecidable(row.item)) continue
      goToRow(row)
      return
    }
  }

  function decide(action: 'accept' | 'reject') {
    if (!active || active.kind !== 'change') return
    review.decideChange(action, itemLead(active.item))
  }

  return (
    <DockedPanel
      title="Changes and comments"
      onClose={onClose}
      popout={popout}
      footer={
        // One bar at a time: a selection says what the bulk action will do,
        // and hides the per-change bar that would otherwise sit beside an
        // enabled-looking Accept for a change the reader did not select.
        bulkActive ? (
          <ReviewBulkBar
            count={selectedItems.length}
            versionNumber={currentVersionNumber}
            reason={selectionReason}
            onAccept={() => review.decideSelected('accept', selectedIds)}
            onReject={() => review.decideSelected('reject', selectedIds)}
            onClear={() => setSelected(new Set())}
          />
        ) : (
          <ReviewDecisionBar
            item={active?.kind === 'change' ? active.item : undefined}
            location={active?.location}
            position={activeIndex + 1}
            total={rows.length}
            reason={
              review.unavailable ??
              (active?.kind === 'change' ? review.targetUnavailable : undefined)
            }
            pending={review.pending}
            canPrevious={activeIndex > 0}
            canNext={
              activeIndex < 0 ? rows.length > 0 : activeIndex < rows.length - 1
            }
            onPrevious={() => step(-1)}
            onNext={() => step(1)}
            onAccept={() => decide('accept')}
            onReject={() => decide('reject')}
          />
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">
            {counts.changes === 1
              ? '1 change'
              : `${String(counts.changes)} changes`}
            {counts.moves > 0
              ? ` · ${counts.moves === 1 ? '1 move' : `${String(counts.moves)} moves`}`
              : ''}
            {commentCount > 0
              ? ` · ${commentCount === 1 ? '1 comment' : `${String(commentCount)} comments`}`
              : ''}
          </p>
          {rows.length > 0 ? (
            <SegmentedControl<ReviewFilter>
              label="Filter changes and comments"
              value={filter}
              // A filter that hid a selected row would let a bulk decision run
              // on something the reader cannot see, so changing it clears the
              // selection rather than warning about it.
              onChange={(next) => {
                setFilter(next)
                setSelected(new Set())
              }}
              options={[
                { value: 'all', label: `All ${String(rows.length)}` },
                ...(counts.changes > 0
                  ? [
                      {
                        value: 'change' as const,
                        label: `Changes ${String(counts.changes)}`,
                      },
                    ]
                  : []),
                ...(commentCount > 0
                  ? [
                      {
                        value: 'comment' as const,
                        label: `Comments ${String(commentCount)}`,
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
        {review.error ? (
          <p className="text-caption text-danger" role="alert">
            {review.error}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            body="Tracked changes and comments appear here in document order."
          />
        ) : visible.length === 0 ? (
          <p className="text-caption text-muted">No rows match this filter.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((row) => {
              const isActive = row === active
              const noteId = `review-row-${row.id}`
              if (row.kind === 'comment') {
                return (
                  <CommentRow
                    key={row.id}
                    row={row}
                    active={isActive}
                    onOpen={() => goToRow(row)}
                  />
                )
              }
              const undecidable = !itemDecidable(row.item)
              const leadChange = itemLead(row.item)
              const reason = undecidable
                ? (review.undecidableReason(leadChange) ??
                  (leadChange.kind === 'move'
                    ? "This move's two halves could not be paired here, so it cannot be decided. It stays listed and unchanged in the document."
                    : 'This change cannot be decided here; it stays listed and unchanged in the document.'))
                : undefined
              const describedBy =
                [reason ? noteId : null, decideBlocked ? barrierNoteId : null]
                  .filter((id): id is string => id !== null)
                  .join(' ') || undefined
              const lead = itemLead(row.item)
              const style = reviewerStyle(lead.author)
              return (
                <li
                  key={row.id}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'flex gap-2 border-t border-line py-3 first:border-t-0',
                    isActive && 'rounded-md bg-raised px-2',
                    undecidable && 'bg-warning-soft px-2',
                  )}
                >
                  <div className="flex w-5 shrink-0 items-start justify-center pt-0.5">
                    {undecidable ? null : (
                      <input
                        type="checkbox"
                        className="size-3.5 accent-brand"
                        checked={selected.has(row.id)}
                        aria-label={`Select the ${itemKindLabel(row.item).toLowerCase()} by ${lead.author ?? 'an unknown author'}`}
                        onChange={() => toggle(row)}
                      />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-col gap-1 text-left"
                      aria-label={
                        isActive ? 'Current change' : 'Show this change'
                      }
                      onClick={() => goToRow(row)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          data-reviewer={style.slot}
                          className={cn(
                            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium',
                            style.surface,
                            style.text,
                          )}
                          aria-hidden
                        >
                          {style.initials}
                        </span>
                        <span className="min-w-0 truncate text-item text-ink">
                          {lead.author ?? 'Unknown author'}
                        </span>
                        <span className="ms-auto shrink-0 text-caption text-subtle">
                          {lead.date ? formatDateTime(lead.date) : 'No date'}
                        </span>
                      </span>
                      <span className="text-caption text-subtle">
                        {row.location} · {itemKindLabel(row.item)}
                      </span>
                      <ChangeText item={row.item} />
                      {row.context ? (
                        <span className="truncate text-caption text-muted">
                          {row.context}
                        </span>
                      ) : null}
                    </button>
                    {reason ? (
                      <p
                        id={noteId}
                        className="text-caption text-muted"
                        role="note"
                      >
                        {reason}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={decideBlocked || Boolean(reason)}
                        aria-describedby={describedBy}
                        onClick={() => review.decideChange('reject', lead)}
                        iconStart={<X size={12} aria-hidden />}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={decideBlocked || Boolean(reason)}
                        aria-describedby={describedBy}
                        onClick={() => review.decideChange('accept', lead)}
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

function CommentRow({
  row,
  active,
  onOpen,
}: {
  row: Extract<ReviewRow, { kind: 'comment' }>
  active: boolean
  onOpen: () => void
}) {
  const comment = row.comment
  const resolved =
    'resolvedAt' in comment ? comment.resolvedAt !== null : comment.resolved
  const author =
    typeof comment.author === 'string'
      ? comment.author
      : (comment.author?.name ?? 'Unknown author')
  const style = reviewerStyle(author)
  const body = 'body' in comment ? comment.body : ''
  return (
    <li
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-1 border-t border-line py-3 first:border-t-0',
        resolved && 'opacity-70',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-col gap-1 text-left"
        aria-label={
          row.imported ? 'Comment from the Word file' : 'Show this comment'
        }
        onClick={row.imported ? undefined : onOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            data-reviewer={style.slot}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium',
              style.surface,
              style.text,
            )}
            aria-hidden
          >
            {style.initials}
          </span>
          <span className="min-w-0 truncate text-item text-ink">{author}</span>
          <span className="ms-auto shrink-0 text-caption text-subtle">
            <ChatText size={12} aria-hidden /> Comment
          </span>
        </span>
        <span className="text-caption text-subtle">
          {row.location}
          {resolved ? ' · resolved' : ''}
          {row.imported ? ' · from the Word file' : ''}
        </span>
        <span className="whitespace-pre-wrap text-body text-ink">
          {changedWords(body, 160)}
        </span>
        {row.context ? (
          <span className="truncate text-caption text-muted">
            {row.context}
          </span>
        ) : null}
      </button>
    </li>
  )
}

/** The changed words themselves, marked the way the page marks them. */
function ChangeText({ item }: { item: ReviewItem }) {
  const lead = itemLead(item)
  if (!lead.text) {
    return <span className="text-body text-muted">Formatting</span>
  }
  const deleted =
    lead.kind === 'delete' ||
    (lead.kind === 'move' && lead.direction === 'from')
  const style = reviewerStyle(lead.author)
  return (
    <span
      data-reviewer={style.slot}
      className={cn(
        'text-body break-words whitespace-pre-wrap',
        style.text,
        deleted ? 'line-through' : 'underline',
      )}
    >
      {item.kind === 'move' && item.members.length < 2 ? (
        <Badge tone="warning">Move · cannot be paired</Badge>
      ) : null}{' '}
      {labelledBreaks(changedWords(lead.text))}
    </span>
  )
}
