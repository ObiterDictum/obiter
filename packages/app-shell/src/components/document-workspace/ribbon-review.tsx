import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChatText,
  Check,
  CheckCircle,
  Checks,
  DownloadSimple,
  EyeSlash,
  Files,
  FrameCorners,
  ListChecks,
  ListDashes,
  ListMagnifyingGlass,
  LockSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Note,
  PencilLine,
  Printer,
  Prohibit,
  Ruler,
  Scales,
  SealCheck,
  TextAa,
  TextT,
  X,
} from '@phosphor-icons/react'
import type {
  DocumentFindToolbar,
  DocumentReviewToolbar,
  DocumentStructureToolbar,
} from './ribbon-types'
import {
  IconButton,
  RibbonSelect,
  ToolbarGroup,
  ToolbarRow,
} from './ribbon-primitives'
import { FindControls } from './ribbon-find'
import { revealDocumentRedactionRuns } from './document-actions'
import { useVerificationWorkspace } from '../verification/verification-context'

export function ReferencesRibbon({
  authoritiesOpen,
  onToggleAuthorities,
  onInsertAuthority,
  structure,
}: {
  authoritiesOpen: boolean
  onToggleAuthorities: () => void
  onInsertAuthority: () => void
  structure?: DocumentStructureToolbar
}) {
  const verification = useVerificationWorkspace()
  // The one document-level Verify control owns the action; this entry reveals
  // it. The context exposes one canonical availability, so this entry is never
  // enabled while the dock has no control to reveal, and a disabled entry
  // carries the honest reason on its accessible name.
  const startAvailability = verification?.startAvailability
  const verifyReason =
    startAvailability && !startAvailability.available
      ? startAvailability.reason
      : null
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="References"
    >
      <ToolbarGroup label="Authorities">
        <ToolbarRow>
          <IconButton
            label="Insert authority"
            onClick={onInsertAuthority}
            icon={<Scales size={16} aria-hidden />}
          />
          <IconButton
            label="Verify citations"
            soon={verification ? undefined : true}
            disabled={
              verification ? startAvailability?.available === false : undefined
            }
            disabledReason={verifyReason ?? undefined}
            onClick={() => verification?.revealStart()}
            icon={<SealCheck size={16} aria-hidden />}
          />
          <IconButton
            label="List of authorities"
            pressed={authoritiesOpen}
            onClick={onToggleAuthorities}
            icon={<ListDashes size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Citation style"
            soon
            className="w-[6.5rem]"
            value="oscola"
            options={[
              { value: 'oscola', label: 'OSCOLA' },
              { value: 'house', label: 'House style' },
            ]}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Defined terms">
        <ToolbarRow>
          <IconButton
            label="Mark defined term"
            soon
            icon={<TextT size={16} aria-hidden />}
          />
          <IconButton
            label="Check defined terms"
            soon
            icon={<ListMagnifyingGlass size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Cross-references">
        <ToolbarRow>
          <IconButton
            label="Insert cross-reference"
            soon
            icon={<BookOpen size={16} aria-hidden />}
          />
          <IconButton
            label="Check cross-references"
            soon
            icon={<CheckCircle size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Notes">
        <ToolbarRow>
          <IconButton
            label="Insert footnote"
            soon
            icon={<Note size={16} aria-hidden />}
          />
          <IconButton
            label="Table of contents"
            onClick={structure?.onInsertTableOfContents}
            disabled={
              !structure || Boolean(structure.tableOfContentsUnavailable)
            }
            disabledReason={structure?.tableOfContentsUnavailable}
            icon={<ListChecks size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
    </div>
  )
}

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
  onPrint,
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
  onPrint?: () => void
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="Review"
    >
      <ToolbarGroup label="Proofing">
        <IconButton
          label="Spelling"
          soon
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
            disabledReason="There is no earlier change."
            onClick={review?.onPreviousChange}
            icon={<ArrowUp size={16} aria-hidden />}
          />
          <IconButton
            label="Next change"
            disabled={!review || !review.canNext}
            disabledReason="There is no later change."
            onClick={review?.onNextChange}
            icon={<ArrowDown size={16} aria-hidden />}
          />
        </ToolbarRow>
        <ToolbarRow>
          <IconButton
            label="Accept change"
            disabled={!review || Boolean(review.targetUnavailable)}
            disabledReason={review?.targetUnavailable}
            onClick={review?.onAcceptChange}
            icon={<Check size={16} aria-hidden />}
          />
          <IconButton
            label="Reject change"
            disabled={!review || Boolean(review.targetUnavailable)}
            disabledReason={review?.targetUnavailable}
            onClick={review?.onRejectChange}
            icon={<X size={16} aria-hidden />}
          />
          <IconButton
            label="Accept all changes"
            disabled={!review || Boolean(review.bulkUnavailable)}
            disabledReason={review?.bulkUnavailable}
            onClick={review?.onAcceptAll}
            icon={<Checks size={16} aria-hidden />}
          />
          <IconButton
            label="Reject all changes"
            disabled={!review || Boolean(review.bulkUnavailable)}
            disabledReason={review?.bulkUnavailable}
            onClick={review?.onRejectAll}
            icon={<Prohibit size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Versions">
        <IconButton
          label="Compare versions"
          soon
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
            soon
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

export function ViewRibbon({
  zoom,
  onZoom,
}: {
  zoom: number
  onZoom: (next: number) => void
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="View"
    >
      <ToolbarGroup label="Views">
        <IconButton
          label="Print layout"
          pressed
          icon={<FrameCorners size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Show">
        <ToolbarRow>
          <IconButton
            label="Ruler"
            soon
            icon={<Ruler size={16} aria-hidden />}
          />
          <IconButton
            label="Navigation pane"
            soon
            icon={<ListDashes size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Zoom">
        <ToolbarRow>
          <IconButton
            label="Zoom out"
            onClick={() => onZoom(Math.max(75, zoom - 10))}
            icon={<MagnifyingGlassMinus size={16} aria-hidden />}
          />
          <span className="w-10 text-center font-mono text-[11px] text-muted">
            {zoom}%
          </span>
          <IconButton
            label="Zoom in"
            onClick={() => onZoom(Math.min(140, zoom + 10))}
            icon={<MagnifyingGlassPlus size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
    </div>
  )
}
