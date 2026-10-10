import {
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react'
import { CaptionButton, IconButton, ToolbarRow } from './ribbon-primitives'
import type { DocumentFindToolbar } from './ribbon-types'

export function ZoomControls({
  zoom,
  onZoom,
}: {
  zoom: number
  onZoom: (zoom: number) => void
}) {
  return (
    <ToolbarRow>
      <IconButton
        label="Zoom out"
        disabled={zoom <= 50}
        onClick={() => onZoom(zoom - 10)}
        icon={<MagnifyingGlassMinus size={16} aria-hidden />}
      />
      <span className="min-w-12 text-center font-mono text-[11px] text-muted">
        {zoom}%
      </span>
      <IconButton
        label="Zoom in"
        disabled={zoom >= 200}
        onClick={() => onZoom(zoom + 10)}
        icon={<MagnifyingGlassPlus size={16} aria-hidden />}
      />
    </ToolbarRow>
  )
}

export function FindControls({ find }: { find: DocumentFindToolbar }) {
  // The replace group is all-or-none on the toolbar contract: a read-only
  // surface like PDF omits it whole.
  const canReplace = find.onReplaceAll !== undefined
  return (
    <div className="flex flex-col gap-1">
      <ToolbarRow>
        <input
          id="document-find"
          type="text"
          value={find.query}
          onChange={(event) => find.onQuery(event.target.value)}
          placeholder="Find"
          aria-label="Find in document"
          className="h-7 w-32 rounded border border-line bg-canvas px-1.5 text-[12px] text-ink placeholder:text-subtle pointer-coarse:h-11"
        />
        <span
          role="status"
          className="min-w-12 text-center font-mono text-[11px] text-muted"
        >
          {find.matchLabel}
        </span>
        <IconButton label="Previous match" onClick={find.onPrevious} icon="‹" />
        <IconButton label="Next match" onClick={find.onNext} icon="›" />
        <CaptionButton
          label="Match case"
          pressed={find.options.matchCase}
          onClick={() => find.onToggleOption('matchCase')}
        />
        <CaptionButton
          label="Whole word"
          pressed={find.options.wholeWord}
          onClick={() => find.onToggleOption('wholeWord')}
        />
      </ToolbarRow>
      {canReplace ? (
        <ToolbarRow>
          <input
            type="text"
            value={find.replace}
            onChange={(event) => find.onReplace?.(event.target.value)}
            placeholder="Replace with"
            aria-label="Replace in document"
            className="h-7 w-32 rounded border border-line bg-canvas px-1.5 text-[12px] text-ink placeholder:text-subtle pointer-coarse:h-11"
          />
          <CaptionButton
            label="Replace"
            disabled={!find.canReplace}
            onClick={find.onReplaceOne}
          />
          <CaptionButton
            label="Replace all"
            disabled={!find.canReplace}
            onClick={find.onReplaceAll}
          />
        </ToolbarRow>
      ) : null}
    </div>
  )
}
