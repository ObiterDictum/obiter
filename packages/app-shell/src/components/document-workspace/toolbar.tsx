import type { DocumentPresence } from '@obiter/contracts'
import { Button, Tabs, TabsContent, TabsList } from '@obiter/ui'
import { DownloadSimple, FloppyDisk } from '@phosphor-icons/react'
import { HomeRibbon } from './ribbon-home'
import { FindControls, ZoomControls } from './ribbon-find'
import { InsertRibbon, LayoutRibbon } from './ribbon-insert-layout'
import { ReferencesRibbon, ReviewRibbon, ViewRibbon } from './ribbon-review'
import { IconButton, RibbonTab, ToolbarGroup } from './ribbon-primitives'
import type { DocumentFindToolbar, DocumentFormatToolbar } from './ribbon-types'

export type { DocumentFindToolbar, DocumentFormatToolbar }

export function DocumentWorkspaceToolbar({
  kind,
  dirty,
  saving,
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
  onToggleTrackChanges,
  onZoom,
  onExportText,
  onSave,
  onUndo,
  onInsertParagraph,
  onDeleteParagraph,
  canEdit,
  canUndo,
  format,
  find,
}: {
  kind: 'docx' | 'pdf'
  dirty: boolean
  saving: boolean
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
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onSave: () => void
  onUndo?: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  canEdit: boolean
  canUndo?: boolean
  format?: DocumentFormatToolbar
  find?: DocumentFindToolbar
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
                key={item.userId}
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
            format={format}
            onUndo={onUndo}
            onInsertParagraph={onInsertParagraph}
            onDeleteParagraph={onDeleteParagraph}
          />
        </TabsContent>
        <TabsContent value="insert" className="min-w-0 flex-1 pt-0">
          <InsertRibbon
            commentsOpen={commentsOpen}
            commentCount={commentCount}
            onToggleComments={onToggleComments}
          />
        </TabsContent>
        <TabsContent value="layout" className="min-w-0 flex-1 pt-0">
          <LayoutRibbon />
        </TabsContent>
        <TabsContent value="references" className="min-w-0 flex-1 pt-0">
          <ReferencesRibbon
            authoritiesOpen={authoritiesOpen}
            onToggleAuthorities={onToggleAuthorities}
            onInsertAuthority={onInsertAuthority}
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
            onToggleComments={onToggleComments}
            onToggleChanges={onToggleChanges}
            onToggleTrackChanges={onToggleTrackChanges}
            onExportText={onExportText}
          />
        </TabsContent>
        <TabsContent value="view" className="min-w-0 flex-1 pt-0">
          <ViewRibbon zoom={zoom} onZoom={onZoom} />
        </TabsContent>
        <div className="ml-auto flex shrink-0 items-center self-center pr-1">
          <Button
            size="sm"
            aria-label="Save"
            disabled={!dirty || saving}
            loading={saving}
            onClick={onSave}
            iconStart={<FloppyDisk size={16} aria-hidden />}
          >
            Save
          </Button>
        </div>
      </div>
    </Tabs>
  )
}

function shortUserLabel(userId: string) {
  return userId.length <= 10 ? userId : userId.slice(-8)
}
