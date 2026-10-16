import {
  rulerLabel,
  rulerMarkers,
  rulerTicks,
  type RulerGeometry,
} from '../../document-ruler'
import type { ParagraphFace } from '../../document-page-style'

/**
 * The horizontal ruler: the sheet's real measure — margins, centimetre ticks
 * and the caret paragraph's indent markers — scaled with the desk's zoom.
 * It presents measurements only; it is not an interactive control, so it is
 * exposed as one labelled image rather than focusable chrome.
 */
export function DocumentRuler({
  geometry,
  face,
  list,
  zoom,
}: {
  geometry: RulerGeometry
  face?: ParagraphFace
  list?: { leftPx: number; hangingPx: number }
  zoom: number
}) {
  const scale = zoom / 100
  const markers = rulerMarkers({
    face,
    list,
    columnWidthPx: geometry.column.widthPx,
  })
  const columnLeft = geometry.frame.left + geometry.column.left
  const columnRight = columnLeft + geometry.column.widthPx
  const markerAt = (px: number) => (columnLeft + px) * scale

  return (
    <div
      data-document-ruler
      role="img"
      aria-label={rulerLabel({ geometry, markers })}
      className="relative h-6 shrink-0 select-none overflow-hidden rounded-sm bg-raised ring-1 ring-line"
      style={{ width: geometry.box.widthPx * scale }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-muted/20"
        style={{ width: columnLeft * scale }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 bg-muted/20"
        style={{ left: columnRight * scale }}
      />
      {rulerTicks(geometry.box.widthPx).map((tick) => (
        <span
          key={tick.positionPx}
          aria-hidden="true"
          className="absolute top-0 flex w-4 -translate-x-2 justify-center text-[8px] leading-none text-muted"
          style={{ left: tick.positionPx * scale }}
        >
          <span className="absolute top-[10px] h-[3px] w-px bg-subtle" />
          {tick.label !== undefined && tick.positionPx > 0 ? tick.label : null}
        </span>
      ))}
      <RulerMarker kind="first" positionPx={markerAt(markers.firstLinePx)} />
      <RulerMarker kind="left" positionPx={markerAt(markers.leftPx)} />
      <RulerMarker kind="right" positionPx={markerAt(markers.rightPx)} />
    </div>
  )
}

/** One indent marker — a filled triangle pointing at its measure. */
function RulerMarker({
  kind,
  positionPx,
}: {
  kind: 'first' | 'left' | 'right'
  positionPx: number
}) {
  const shape =
    kind === 'first'
      ? 'top-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-ink'
      : 'bottom-0 border-x-[5px] border-b-[7px] border-x-transparent border-b-ink'
  return (
    <span
      aria-hidden="true"
      data-ruler-marker={kind}
      className={`absolute h-0 w-0 -translate-x-[5px] ${shape}`}
      style={{ left: positionPx }}
    />
  )
}
