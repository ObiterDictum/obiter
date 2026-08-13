import { Badge, Button, cn } from '@obiter/ui'
import {
  ChatText,
  DownloadSimple,
  FloppyDisk,
  ListChecks,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import type { DocumentPresence } from '@obiter/contracts'

export function DocumentWorkspaceToolbar({
  kind,
  dirty,
  saving,
  trackChanges,
  zoom,
  commentsOpen,
  changesOpen,
  commentCount,
  changeCount,
  presence,
  currentUserId,
  onToggleComments,
  onToggleChanges,
  onToggleTrackChanges,
  onZoom,
  onExportText,
  onSave,
  onInsertParagraph,
  onDeleteParagraph,
  canEdit,
}: {
  kind: 'docx' | 'pdf'
  dirty: boolean
  saving: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  commentCount: number
  changeCount: number
  presence: DocumentPresence[]
  currentUserId?: string
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onSave: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  canEdit: boolean
}) {
  const others = presence.filter((item) => item.userId !== currentUserId)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Zoom out"
          onClick={() => onZoom(Math.max(75, zoom - 10))}
          iconStart={<MagnifyingGlassMinus size={16} aria-hidden />}
        />
        <span className="w-10 text-center font-mono text-xs text-muted">
          {zoom}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Zoom in"
          onClick={() => onZoom(Math.min(140, zoom + 10))}
          iconStart={<MagnifyingGlassPlus size={16} aria-hidden />}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onExportText}
          iconStart={<DownloadSimple size={16} aria-hidden />}
        >
          Export
        </Button>
        {kind === 'pdf' ? (
          <span className="pl-2 text-xs text-muted">
            View only, not editable
          </span>
        ) : null}
        {kind === 'docx' ? (
          <>
            <Button
              variant={commentsOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={onToggleComments}
              iconStart={<ChatText size={16} aria-hidden />}
            >
              Comments{commentCount > 0 ? ` (${commentCount})` : ''}
            </Button>
            <Button
              variant={changesOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={onToggleChanges}
              iconStart={<ListChecks size={16} aria-hidden />}
            >
              Changes{changeCount > 0 ? ` (${changeCount})` : ''}
            </Button>
          </>
        ) : null}
        {kind === 'docx' && canEdit ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onInsertParagraph}
              iconStart={<Plus size={16} aria-hidden />}
            >
              Insert
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeleteParagraph}
              iconStart={<Trash size={16} aria-hidden />}
            >
              Delete
            </Button>
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center rounded-md px-3 text-sm text-ink',
                'hover:bg-raised',
              )}
              aria-pressed={trackChanges}
              onClick={onToggleTrackChanges}
            >
              Track changes {trackChanges ? 'on' : 'off'}
            </button>
            <Button
              size="sm"
              disabled={!dirty || saving}
              loading={saving}
              onClick={onSave}
              iconStart={<FloppyDisk size={16} aria-hidden />}
            >
              Save
            </Button>
          </>
        ) : null}
      </div>
      {others.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Editors present"
        >
          {others.map((item) => (
            <Badge key={item.userId} tone="info">
              {shortUserLabel(item.userId)}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function shortUserLabel(userId: string) {
  return userId.length <= 10 ? userId : userId.slice(-8)
}
