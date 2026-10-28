/**
 * The View ribbon: layout mode, ruler, navigation pane and zoom.
 */
import {
  FrameCorners,
  GlobeSimple,
  ListDashes,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Ruler,
} from '@phosphor-icons/react'
import { IconButton, ToolbarGroup, ToolbarRow } from './ribbon-primitives'

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
      className="flex min-w-0 flex-1 flex-nowrap items-stretch overflow-x-auto"
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
