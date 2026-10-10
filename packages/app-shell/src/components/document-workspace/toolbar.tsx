import type { DocumentPresence } from '@obiter/contracts'
import { Button, Tabs, TabsContent, TabsList } from '@obiter/ui'
import {
  DownloadSimple,
  FileArrowDown,
  FloppyDisk,
} from '@phosphor-icons/react'
import { HomeRibbon } from './ribbon-home'
import { FindControls, ZoomControls } from './ribbon-find'
import { InsertRibbon, LayoutRibbon } from './ribbon-insert-layout'
import {
  ReferencesRibbon,
  ReviewRibbon,
  ViewRibbon,
  type LegalChecksFocus,
} from './ribbon-review'
import { IconButton, RibbonTab, ToolbarGroup } from './ribbon-primitives'
import type {
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

export function DocumentWorkspaceToolbar({
  kind,
  dirty,
  saving,
  blocked,
  trackChanges,
  zoom,
  commentsOpen,
  changesOpen,
  authoritiesOpen,
  commentCount,
  changeCount,
  presence,
  currentUserId,
  onToggleComments,
  onToggleChanges,
  onToggleAuthorities,
  onInsertAuthority,
  citationStyle,
  onCitationStyle,
  legalChecks,
  onToggleTrackChanges,
  onZoom,
  onExportText,
  onExportShareSafe,
  onPrint,
  onDownload,
  onSave,
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
}: {
  kind: 'docx' | 'pdf'
  dirty: boolean
  saving: boolean
  /** The committed save's history could not be reconciled; saving is refused. */
  blocked?: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  commentCount: number
  changeCount: number
  presence: DocumentPresence[]
  currentUserId?: string
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
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onExportShareSafe?: () => void
  onPrint?: () => void
  onDownload?: () => void
  onSave: () => void
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
}) {
  const others = presence.filter((item) => item.userId !== currentUserId)

  if (kind === 'pdf') {
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

  return (
    <Tabs defaultValue="home">
      <div className="flex min-w-0 items-end justify-between gap-3 px-3">
        <TabsList
          aria-label="Ribbon"
          className="inline-flex flex-wrap items-end gap-0 rounded-none bg-transparent p-0"
        >
          <RibbonTab value="home">Home</RibbonTab>
          <RibbonTab value="insert">Insert</RibbonTab>
          <RibbonTab value="layout">Layout</RibbonTab>
          <RibbonTab value="references">References</RibbonTab>
          <RibbonTab value="review">Review</RibbonTab>
          <RibbonTab value="view">View</RibbonTab>
        </TabsList>
        {others.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-1 pb-1.5"
            aria-label="Editors present"
          >
            {others.map((item) => (
              <span
                key={item.clientId ?? item.userId}
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-raised px-1.5 text-[10px] font-medium text-muted ring-1 ring-line"
              >
                {shortUserLabel(item.userId)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 items-stretch gap-2 overflow-x-auto border-t border-line px-2 py-1.5">
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
        <div className="ml-auto flex shrink-0 items-center self-center pr-1">
          {/* preventDefault keeps the caret in the editor while the save
              flight runs, so keystrokes typed during it still land. Keyboard
              activation instead leaves focus on the button; the save path
              hands it back before `saving` disables the control and the
              browser drops focus to document.body. */}
          <span onMouseDown={(event) => event.preventDefault()}>
            <Button
              size="sm"
              aria-label="Save"
              disabled={!dirty || saving || blocked}
              loading={saving}
              onClick={onSave}
              iconStart={<FloppyDisk size={16} aria-hidden />}
            >
              Save
            </Button>
          </span>
        </div>
      </div>
    </Tabs>
  )
}

function shortUserLabel(userId: string) {
  return userId.length <= 10 ? userId : userId.slice(-8)
}
