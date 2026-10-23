/**
 * The Review ribbon: proofing, find, comments, tracked-change review, redaction
 * and export.
 */
import {
  ArrowDown,
  ArrowUp,
  ChatText,
  Check,
  Checks,
  DownloadSimple,
  EyeSlash,
  Files,
  ListChecks,
  LockSimple,
  PencilLine,
  Printer,
  Prohibit,
  TextAa,
  X,
} from '@phosphor-icons/react'
import type { DocumentFindToolbar, DocumentReviewToolbar } from './ribbon-types'
import { IconButton, ToolbarGroup, ToolbarRow } from './ribbon-primitives'
import { FindControls } from './ribbon-find'
import { revealDocumentRedactionRuns } from './document-actions'

export function ReviewRibbon({
  canEdit,
  trackChanges,
  commentsOpen,
  changesOpen,
  commentCount,
  changeCount,
  find,
  review,
  onToggleComments,
  onToggleChanges,
  onToggleTrackChanges,
  onExportText,
  onExportShareSafe,
  onPrint,
  spelling,
  onToggleSpelling,
  onCompareVersions,
}: {
  canEdit: boolean
  trackChanges: boolean
  commentsOpen: boolean
  changesOpen: boolean
  commentCount: number
  changeCount: number
  find?: DocumentFindToolbar
  /** The shared review state; absent only outside an editable workspace. */
  review?: DocumentReviewToolbar
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleTrackChanges: () => void
  onExportText: () => void
  onExportShareSafe?: () => void
  onPrint?: () => void
  /** Whether the browser's local dictionary underlines flagged words. */
  spelling?: boolean
  /** Absent where proofing is not offered; the control then keeps its
   * honest unavailable state instead of a no-op toggle. */
  onToggleSpelling?: () => void
  onCompareVersions?: () => void
}) {
  // Boundary reasons would be false when this ribbon has no review at all;
  // the absent surface is the truer reason there.
  const reviewAbsent = 'Change review is not available for this document.'
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="Review"
    >
      <ToolbarGroup label="Proofing">
        <IconButton
          label="Spelling"
          soon={onToggleSpelling === undefined}
          pressed={spelling}
          hint="Underlines words the browser's dictionary flags. No document text leaves this device, and it is not a legal correctness check."
          onClick={onToggleSpelling}
          icon={<TextAa size={16} aria-hidden />}
        />
      </ToolbarGroup>
      {find ? (
        <ToolbarGroup label="Find">
          <FindControls find={find} />
        </ToolbarGroup>
      ) : null}
      <ToolbarGroup label="Comments">
        <IconButton
          label={commentCount > 0 ? `Comments (${commentCount})` : 'Comments'}
          pressed={commentsOpen}
          onClick={onToggleComments}
          icon={<ChatText size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Tracking">
        <ToolbarRow>
          <IconButton
            label={trackChanges ? 'Track changes on' : 'Track changes off'}
            pressed={trackChanges}
            disabled={!canEdit}
            onClick={onToggleTrackChanges}
            icon={<PencilLine size={16} aria-hidden />}
          />
          <IconButton
            label={changeCount > 0 ? `Changes (${changeCount})` : 'Changes'}
            pressed={changesOpen}
            onClick={onToggleChanges}
            icon={<ListChecks size={16} aria-hidden />}
          />
          <IconButton
            label="Previous change"
            disabled={!review || !review.canPrevious}
            disabledReason={
              review ? 'There is no earlier change.' : reviewAbsent
            }
            onClick={review?.onPreviousChange}
            icon={<ArrowUp size={16} aria-hidden />}
          />
          <IconButton
            label="Next change"
            disabled={!review || !review.canNext}
            disabledReason={review ? 'There is no later change.' : reviewAbsent}
            onClick={review?.onNextChange}
            icon={<ArrowDown size={16} aria-hidden />}
          />
        </ToolbarRow>
        <ToolbarRow>
          <IconButton
            label="Accept change"
            disabled={!review || Boolean(review.targetUnavailable)}
            disabledReason={review?.targetUnavailable ?? reviewAbsent}
            onClick={review?.onAcceptChange}
            icon={<Check size={16} aria-hidden />}
          />
          <IconButton
            label="Reject change"
            disabled={!review || Boolean(review.targetUnavailable)}
            disabledReason={review?.targetUnavailable ?? reviewAbsent}
            onClick={review?.onRejectChange}
            icon={<X size={16} aria-hidden />}
          />
          <IconButton
            label={
              review && review.undecidableCount > 0
                ? 'Accept all supported changes'
                : 'Accept all changes'
            }
            disabled={!review || Boolean(review.bulkUnavailable)}
            disabledReason={review?.bulkUnavailable ?? reviewAbsent}
            onClick={review?.onAcceptAll}
            icon={<Checks size={16} aria-hidden />}
          />
          <IconButton
            label={
              review && review.undecidableCount > 0
                ? 'Reject all supported changes'
                : 'Reject all changes'
            }
            disabled={!review || Boolean(review.bulkUnavailable)}
            disabledReason={review?.bulkUnavailable ?? reviewAbsent}
            onClick={review?.onRejectAll}
            icon={<Prohibit size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Versions">
        <IconButton
          label="Compare versions"
          soon={onCompareVersions === undefined}
          onClick={onCompareVersions}
          icon={<Files size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Redact">
        <IconButton
          label="Redact this document"
          onClick={revealDocumentRedactionRuns}
          icon={<EyeSlash size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Export">
        <ToolbarRow>
          <IconButton
            label="Export"
            onClick={onExportText}
            icon={<DownloadSimple size={16} aria-hidden />}
          />
          <IconButton
            label="Share-safe export"
            hint="Removes metadata and comments, and unlinks external hyperlinks"
            onClick={onExportShareSafe}
            icon={<LockSimple size={16} aria-hidden />}
          />
          <IconButton
            label="Print"
            onClick={onPrint}
            icon={<Printer size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
    </div>
  )
}
