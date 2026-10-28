import { Tabs, TabsContent, TabsList } from '@obiter/ui'
import { DownloadSimple, FileArrowDown } from '@phosphor-icons/react'
import { formatDateTime } from '../../format'
import { HomeRibbon } from './ribbon-home'
import { FindControls, ZoomControls } from './ribbon-find'
import { InsertRibbon, LayoutRibbon } from './ribbon-insert-layout'
import { ReferencesRibbon } from './ribbon-references'
import { ReviewRibbon } from './ribbon-review'
import { ViewRibbon } from './ribbon-view'
import { IconButton, RibbonTab, ToolbarGroup } from './ribbon-primitives'
import type {
  LegalChecksFocus,
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
  DocumentStructureToolbar,
} from './ribbon-types'
import type { CitationStyle } from '../../document-preferences'

export type {
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
  DocumentStructureToolbar,
}

/**
 * The read-only PDF surface's toolbar — zoom, find and the file actions. It
 * is its own component rather than a mode of the document toolbar so the
 * editable-document props never exist on a surface that cannot honour them.
 */
export function PdfWorkspaceToolbar({
  zoom,
  onZoom,
  find,
  onExportText,
  onDownload,
}: {
  zoom: number
  onZoom: (next: number) => void
  find?: DocumentFindToolbar
  onExportText: () => void
  onDownload?: () => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 py-2"
      role="toolbar"
      aria-label="Document tools"
    >
      <ToolbarGroup label="View">
        <ZoomControls zoom={zoom} onZoom={onZoom} />
      </ToolbarGroup>
      {find ? (
        <ToolbarGroup label="Find">
          <FindControls find={find} />
        </ToolbarGroup>
      ) : null}
      <ToolbarGroup label="File">
        <IconButton
          label="Export"
          onClick={onExportText}
          icon={<DownloadSimple size={16} aria-hidden />}
        />
        {onDownload ? (
          <IconButton
            label="Download"
            onClick={onDownload}
            icon={<FileArrowDown size={16} aria-hidden />}
          />
        ) : null}
      </ToolbarGroup>
      <span className="pl-2 text-xs text-muted">View only, not editable</span>
    </div>
  )
}

export function DocumentWorkspaceToolbar({
  trackChanges,
  zoom,
  commentsOpen,
  changesOpen,
  authoritiesOpen,
  commentCount,
  changeCount,
  onToggleComments,
  onToggleChanges,
  onToggleAuthorities,
  onInsertAuthority,
  citationStyle,
  onCitationStyle,
  legalChecks,
  onOpenVerify,
  onToggleTrackChanges,
  onZoom,
  onExportText,
  onExportShareSafe,
  onPrint,
  onUndo,
  onRedo,
  onInsertParagraph,
  onDeleteParagraph,
  onPageBreak,
  onSectionBreak,
  breakUnavailable,
  structure,
  canEdit,
  canUndo,
  canRedo,
  deleteParagraphReason,
  format,
  clipboard,
  find,
  review,
  markings,
  view,
  onView,
  rulerOn,
  onToggleRuler,
  navOpen,
  onToggleNavPane,
  spelling,
  onToggleSpelling,
  versionMeta,
}: {
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  commentCount: number
  changeCount: number
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleAuthorities: () => void
  onInsertAuthority: () => void
  /** The persisted citation convention new authority insertions follow. */
  citationStyle?: CitationStyle
  /** Absent where authority insertion is not offered; the style select
   * is disabled without it. */
  onCitationStyle?: (style: CitationStyle) => void
  /** The checks panel the References ribbon's Check controls focus. */
  legalChecks?: {
    open: LegalChecksFocus | null
    onOpen: (focus: LegalChecksFocus) => void
  }
  onOpenVerify?: () => void
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onExportShareSafe?: () => void
  onPrint?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  onPageBreak: () => void
  onSectionBreak: () => void
  /** The reason a break cannot be inserted at the caret, when it cannot. */
  breakUnavailable?: string
  /** The table and picture controls; absent while the document is unloaded. */
  structure?: DocumentStructureToolbar
  canEdit: boolean
  canUndo?: boolean
  canRedo?: boolean
  /** The accessible reason Delete paragraph is unavailable, when it is. */
  deleteParagraphReason?: string
  format?: DocumentFormatToolbar
  clipboard?: DocumentClipboardToolbar
  find?: DocumentFindToolbar
  /** The tracked-change review controls; absent outside an editable model. */
  review?: DocumentReviewToolbar
  /** The Layout ribbon's classification controls; absent while unloaded. */
  markings?: DocumentMarkingsToolbar
  /** The document's layout view; absent outside a paginated editor. */
  view?: 'print' | 'web'
  onView?: (view: 'print' | 'web') => void
  /** The horizontal ruler over the page measure; absent where not offered. */
  rulerOn?: boolean
  onToggleRuler?: () => void
  navOpen?: boolean
  onToggleNavPane?: () => void
  /** Browser-dictionary spell-checking; absent where not offered. */
  spelling?: boolean
  onToggleSpelling?: () => void
  /** The stored version the tab row names, as the mock-up's quiet meta. */
  versionMeta?: { number: number; editedAt: string }
}) {
  return (
    <Tabs defaultValue="home">
      <div className="flex h-[34px] items-stretch justify-between gap-3 border-b border-line px-12 max-compact:px-8">
        <TabsList
          aria-label="Ribbon"
          className="flex items-stretch gap-1 rounded-none bg-transparent p-0"
        >
          <RibbonTab value="home">Home</RibbonTab>
          <RibbonTab value="insert">Insert</RibbonTab>
          <RibbonTab value="layout">Layout</RibbonTab>
          <RibbonTab value="references">References</RibbonTab>
          <RibbonTab value="review">Review</RibbonTab>
          <RibbonTab value="view">View</RibbonTab>
        </TabsList>
        {versionMeta ? (
          <span className="flex shrink-0 items-center gap-2 text-caption whitespace-nowrap text-subtle tabular-nums">
            <span>Version {versionMeta.number}</span>
            <span aria-hidden>·</span>
            <span>Edited {formatDateTime(versionMeta.editedAt)}</span>
          </span>
        ) : null}
      </div>
      <div className="flex min-h-12 min-w-0 items-stretch gap-x-2">
        <TabsContent value="home" className="min-w-0 flex-1 pt-0">
          <HomeRibbon
            canEdit={canEdit}
            canUndo={canUndo}
            canRedo={canRedo}
            format={format}
            clipboard={clipboard}
            deleteParagraphReason={deleteParagraphReason}
            onUndo={onUndo}
            onRedo={onRedo}
            onInsertParagraph={onInsertParagraph}
            onDeleteParagraph={onDeleteParagraph}
          />
        </TabsContent>
        <TabsContent value="insert" className="min-w-0 flex-1 pt-0">
          <InsertRibbon
            commentsOpen={commentsOpen}
            commentCount={commentCount}
            onToggleComments={onToggleComments}
            onPageBreak={onPageBreak}
            onSectionBreak={onSectionBreak}
            breakUnavailable={breakUnavailable}
            structure={structure}
          />
        </TabsContent>
        <TabsContent value="layout" className="min-w-0 flex-1 pt-0">
          <LayoutRibbon format={format} markings={markings} />
        </TabsContent>
        <TabsContent value="references" className="min-w-0 flex-1 pt-0">
          <ReferencesRibbon
            authoritiesOpen={authoritiesOpen}
            onToggleAuthorities={onToggleAuthorities}
            onInsertAuthority={onInsertAuthority}
            citationStyle={citationStyle ?? 'oscola'}
            onCitationStyle={onCitationStyle}
            legalChecks={legalChecks}
            structure={structure}
            onOpenVerify={onOpenVerify}
          />
        </TabsContent>
        <TabsContent value="review" className="min-w-0 flex-1 pt-0">
          <ReviewRibbon
            canEdit={canEdit}
            trackChanges={trackChanges}
            commentsOpen={commentsOpen}
            changesOpen={changesOpen}
            commentCount={commentCount}
            changeCount={changeCount}
            find={find}
            review={review}
            onToggleComments={onToggleComments}
            onToggleChanges={onToggleChanges}
            onToggleTrackChanges={onToggleTrackChanges}
            onExportText={onExportText}
            onExportShareSafe={onExportShareSafe}
            onPrint={onPrint}
            spelling={spelling}
            onToggleSpelling={onToggleSpelling}
          />
        </TabsContent>
        <TabsContent value="view" className="min-w-0 flex-1 pt-0">
          <ViewRibbon
            zoom={zoom}
            onZoom={onZoom}
            view={view}
            onView={onView}
            rulerOn={rulerOn}
            onToggleRuler={onToggleRuler}
            navOpen={navOpen}
            onToggleNavPane={onToggleNavPane}
          />
        </TabsContent>
      </div>
    </Tabs>
  )
}
