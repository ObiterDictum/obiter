import { Badge, Button, cn } from '@obiter/ui'
import {
  ChatText,
  DownloadSimple,
  FloppyDisk,
  ListChecks,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Plus,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextUnderline,
  Trash,
} from '@phosphor-icons/react'
import type { DocumentPresence } from '@obiter/contracts'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  bold: boolean
  italic: boolean
  underline: boolean
  canIndent: boolean
  canOutdent: boolean
  canContinue: boolean
  onParagraphStyle: (styleId: string | null) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onIndent: () => void
  onOutdent: () => void
  onContinueList: () => void
}

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
  format,
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
  format?: DocumentFormatToolbar
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
            {format ? <FormatControls format={format} /> : null}
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

function FormatControls({ format }: { format: DocumentFormatToolbar }) {
  return (
    <>
      {format.paragraphStyles.length > 0 ? (
        <select
          aria-label="Paragraph style"
          className="h-8 max-w-40 rounded-md border border-line bg-canvas px-2 text-sm text-ink"
          value={format.paragraphStyleId}
          onChange={(event) =>
            format.onParagraphStyle(
              event.target.value === '' ? null : event.target.value,
            )
          }
        >
          <option value="">No direct style</option>
          {format.paragraphStyles.map((style) => (
            <option key={style.styleId} value={style.styleId}>
              {style.name}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        variant={format.bold ? 'secondary' : 'ghost'}
        size="sm"
        aria-label="Bold"
        aria-pressed={format.bold}
        onClick={format.onToggleBold}
        iconStart={<TextB size={16} aria-hidden />}
      />
      <Button
        variant={format.italic ? 'secondary' : 'ghost'}
        size="sm"
        aria-label="Italic"
        aria-pressed={format.italic}
        onClick={format.onToggleItalic}
        iconStart={<TextItalic size={16} aria-hidden />}
      />
      <Button
        variant={format.underline ? 'secondary' : 'ghost'}
        size="sm"
        aria-label="Underline"
        aria-pressed={format.underline}
        onClick={format.onToggleUnderline}
        iconStart={<TextUnderline size={16} aria-hidden />}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Increase list indent"
        disabled={!format.canIndent}
        onClick={format.onIndent}
        iconStart={<TextIndent size={16} aria-hidden />}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Decrease list indent"
        disabled={!format.canOutdent}
        onClick={format.onOutdent}
        iconStart={<TextOutdent size={16} aria-hidden />}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={!format.canContinue}
        onClick={format.onContinueList}
      >
        Continue list
      </Button>
    </>
  )
}

function shortUserLabel(userId: string) {
  return userId.length <= 10 ? userId : userId.slice(-8)
}
