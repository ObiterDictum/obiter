import { DownloadSimple, FileArrowDown } from '@phosphor-icons/react'
import { EditorIconButton, EditorTextButton } from './editor-controls'
import type { DocumentFindToolbar } from './ribbon-types'

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
      className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1"
      role="toolbar"
      aria-label="Document tools"
    >
      <EditorIconButton
        label="Zoom out"
        disabled={zoom <= 50}
        onClick={() => onZoom(zoom - 10)}
        icon={<span aria-hidden>−</span>}
      />
      <span className="min-w-12 text-center text-caption text-muted tabular-nums">
        {zoom}%
      </span>
      <EditorIconButton
        label="Zoom in"
        disabled={zoom >= 200}
        onClick={() => onZoom(zoom + 10)}
        icon={<span aria-hidden>+</span>}
      />
      {find ? (
        <input
          id="document-find"
          type="text"
          value={find.query}
          onChange={(event) => find.onQuery(event.target.value)}
          placeholder="Find"
          aria-label="Find in document"
          className="h-7 w-32 rounded-sm bg-fill px-2 text-caption text-ink placeholder:text-subtle focus:outline-2 focus:outline-offset-1 focus:outline-ring pointer-coarse:h-11"
        />
      ) : null}
      {find ? (
        <span role="status" className="min-w-12 text-caption text-muted">
          {find.matchLabel}
        </span>
      ) : null}

      {find ? (
        <>
          <EditorIconButton
            label="Previous match"
            onClick={find.onPrevious}
            icon={<span aria-hidden>↑</span>}
          />
          <EditorIconButton
            label="Next match"
            onClick={find.onNext}
            icon={<span aria-hidden>↓</span>}
          />
          <EditorTextButton
            label="Match case"
            pressed={find.options.matchCase}
            onClick={() => find.onToggleOption('matchCase')}
          />
          <EditorTextButton
            label="Whole word"
            pressed={find.options.wholeWord}
            onClick={() => find.onToggleOption('wholeWord')}
          />
        </>
      ) : null}
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <EditorIconButton
        label="Export"
        onClick={onExportText}
        icon={<DownloadSimple size={16} aria-hidden />}
      />
      {onDownload ? (
        <EditorIconButton
          label="Download"
          onClick={onDownload}
          icon={<FileArrowDown size={16} aria-hidden />}
        />
      ) : null}
      <span className="pl-2 text-caption text-muted">
        View only, not editable
      </span>
    </div>
  )
}
