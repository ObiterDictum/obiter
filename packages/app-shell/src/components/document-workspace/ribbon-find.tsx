import {
  ArrowsLeftRight,
  CaretDown,
  CaretUp,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Swap,
} from '@phosphor-icons/react'
import type { DocumentFindToolbar } from './ribbon-types'
import { IconButton } from './ribbon-primitives'

export function ZoomControls({
  zoom,
  onZoom,
}: {
  zoom: number
  onZoom: (next: number) => void
}) {
  return (
    <>
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
    </>
  )
}

export function FindControls({ find }: { find: DocumentFindToolbar }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <MagnifyingGlass size={14} className="shrink-0 text-muted" aria-hidden />
      <input
        id="document-find"
        aria-label="Find in document"
        className="h-7 w-36 rounded-md border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        value={find.query}
        onChange={(event) => find.onQuery(event.target.value)}
      />
      <span className="min-w-12 font-mono text-[11px] text-muted">
        {find.matchLabel}
      </span>
      <IconButton
        label="Previous match"
        onClick={find.onPrevious}
        icon={<CaretUp size={16} aria-hidden />}
      />
      <IconButton
        label="Next match"
        onClick={find.onNext}
        icon={<CaretDown size={16} aria-hidden />}
      />
      <input
        aria-label="Replace in document"
        className="h-7 w-28 rounded-md border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        value={find.replace}
        onChange={(event) => find.onReplace(event.target.value)}
      />
      <IconButton
        label="Replace"
        disabled={!find.canReplace}
        onClick={find.onReplaceOne}
        icon={<ArrowsLeftRight size={16} aria-hidden />}
      />
      <IconButton
        label="Replace all"
        disabled={!find.canReplace}
        onClick={find.onReplaceAll}
        icon={<Swap size={16} aria-hidden />}
      />
    </div>
  )
}
