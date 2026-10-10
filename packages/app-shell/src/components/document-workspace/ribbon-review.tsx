import {
  ArrowDown,
  ArrowsClockwise,
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
  GlobeSimple,
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
import { useState } from 'react'
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
import { InsertCrossReferenceDialog } from './insert-cross-reference-dialog'
import {
  citationStyleSchema,
  type CitationStyle,
} from '../../document-preferences'

/** Which legal-checks section the panel is showing; null when it is closed. */
export type LegalChecksFocus = 'terms' | 'references'

export function ReferencesRibbon({
  authoritiesOpen,
  onToggleAuthorities,
  onInsertAuthority,
  citationStyle,
  onCitationStyle,
  legalChecks,
  structure,
}: {
  authoritiesOpen: boolean
  onToggleAuthorities: () => void
  onInsertAuthority: () => void
  /** The persisted citation convention new insertions are written in. */
  citationStyle: CitationStyle
  /** Absent where authority insertion is not offered; the style select
   * is disabled without it. */
  onCitationStyle?: (style: CitationStyle) => void
  /** The checks panel; absent outside an editable workspace. */
  legalChecks?: {
    open: LegalChecksFocus | null
    onOpen: (focus: LegalChecksFocus) => void
  }
  structure?: DocumentStructureToolbar
}) {
  const [crossReferenceOpen, setCrossReferenceOpen] = useState(false)
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
          <IconButton
            label="Table of authorities"
            onClick={structure?.onInsertTableOfAuthorities}
            disabled={
              !structure || Boolean(structure.tableOfAuthoritiesUnavailable)
            }
            disabledReason={structure?.tableOfAuthoritiesUnavailable}
            icon={<Checks size={16} aria-hidden />}
          />
          <IconButton
            label="Update table"
            onClick={structure?.onUpdateTableOfAuthorities}
            disabled={
              !structure ||
              Boolean(structure.tableOfAuthoritiesUpdateUnavailable)
            }
            disabledReason={structure?.tableOfAuthoritiesUpdateUnavailable}
            icon={<ArrowsClockwise size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Citation style"
            className="w-[6.5rem]"
            disabled={!onCitationStyle}
            value={citationStyle}
            options={[
              { value: 'oscola', label: 'OSCOLA' },
              { value: 'house', label: 'House style' },
            ]}
            onChange={(value) => {
              const parsed = citationStyleSchema.safeParse(value)
              if (parsed.success) onCitationStyle?.(parsed.data)
            }}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Defined terms">
        <ToolbarRow>
          <IconButton
            label="Mark defined term"
            disabled={!structure || Boolean(structure.definedTermUnavailable)}
            disabledReason={structure?.definedTermUnavailable}
            onClick={structure?.onMarkDefinedTerm}
            icon={<TextT size={16} aria-hidden />}
          />
          <IconButton
            label="Check defined terms"
            pressed={legalChecks?.open === 'terms'}
            disabled={!legalChecks}
            onClick={() => legalChecks?.onOpen('terms')}
            icon={<ListMagnifyingGlass size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Cross-references">
        <ToolbarRow>
          <IconButton
            label="Insert cross-reference"
            disabled={
              !structure || Boolean(structure.crossReferenceUnavailable)
            }
            disabledReason={structure?.crossReferenceUnavailable}
            onClick={() => setCrossReferenceOpen(true)}
            icon={<BookOpen size={16} aria-hidden />}
          />
          <IconButton
            label="Check cross-references"
            pressed={legalChecks?.open === 'references'}
            disabled={!legalChecks}
            onClick={() => legalChecks?.onOpen('references')}
            icon={<CheckCircle size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Notes">
        <ToolbarRow>
          <IconButton
            label={
              structure?.editingStoryKind === 'footnotes'
                ? 'Close footnotes'
                : 'Insert footnote'
            }
            pressed={structure?.editingStoryKind === 'footnotes'}
            disabled={
              !structure ||
              (structure.editingStoryKind !== 'footnotes' &&
                Boolean(structure.footnoteUnavailable))
            }
            disabledReason={structure?.footnoteUnavailable}
            onClick={() => {
              if (structure?.editingStoryKind === 'footnotes') {
                structure.onCloseStory()
              } else {
                structure?.onInsertFootnote()
              }
            }}
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
      <InsertCrossReferenceDialog
        open={crossReferenceOpen}
        onOpenChange={setCrossReferenceOpen}
        targets={structure?.crossReferenceTargets ?? []}
        onInsert={(targetParagraphId) =>
          structure?.onInsertCrossReference(targetParagraphId) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
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
  onExportShareSafe,
  onPrint,
  spelling,
  onToggleSpelling,
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

export function ViewRibbon({
  zoom,
  onZoom,
  view,
  onView,
  rulerOn,
  onToggleRuler,
  navOpen,
  onToggleNavPane,
}: {
  zoom: number
  onZoom: (next: number) => void
  /** The document's layout view; absent where the workspace shows a fixed
   * surface (the PDF viewer), in which case the view group is hidden. */
  view?: 'print' | 'web'
  onView?: (view: 'print' | 'web') => void
  /** The horizontal ruler over the page measure; absent where it is not
   * offered, which leaves the control honestly unavailable. */
  rulerOn?: boolean
  onToggleRuler?: () => void
  navOpen?: boolean
  onToggleNavPane?: () => void
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="View"
    >
      {view !== undefined ? (
        <ToolbarGroup label="Views">
          <ToolbarRow>
            <IconButton
              label="Print layout"
              pressed={view === 'print'}
              hint="Page sheets with margins, headers and footers."
              onClick={() => onView?.('print')}
              icon={<FrameCorners size={16} aria-hidden />}
            />
            <IconButton
              label="Web layout"
              pressed={view === 'web'}
              hint="One continuous column at the desk's width; headers, footers and page boundaries are not shown."
              onClick={() => onView?.('web')}
              icon={<GlobeSimple size={16} aria-hidden />}
            />
          </ToolbarRow>
        </ToolbarGroup>
      ) : null}
      <ToolbarGroup label="Show">
        <ToolbarRow>
          <IconButton
            label="Ruler"
            soon={onToggleRuler === undefined}
            pressed={rulerOn}
            onClick={onToggleRuler}
            icon={<Ruler size={16} aria-hidden />}
          />
          <IconButton
            label="Navigation pane"
            soon={onToggleNavPane === undefined}
            pressed={navOpen}
            onClick={onToggleNavPane}
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
