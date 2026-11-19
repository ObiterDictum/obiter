import type { ReactNode } from 'react'
import type { ParagraphLinkOverlay } from '../../document-structure-overlays'
import type { ParagraphSelectionRange } from './model-run'

type ParagraphFieldMarker = { offset: number; label: string }

export function rangedParts(
  text: string,
  from: number,
  paragraphEnd: number,
  selection?: ParagraphSelectionRange,
  overlay?: ParagraphLinkOverlay,
  storedLinkTarget?: string,
) {
  const markers = overlay?.fieldMarkers
  const links = [
    ...(overlay?.links ?? []),
    ...(storedLinkTarget
      ? [{ from, to: from + text.length, target: storedLinkTarget }]
      : []),
  ]
  const marks = overlay?.marks ?? []
  if (
    !selection &&
    links.length === 0 &&
    marks.length === 0 &&
    !markers?.length
  )
    return text
  const clamp = (offset: number) =>
    Math.max(0, Math.min(offset - from, text.length))
  const cuts = new Set<number>([0, text.length])
  if (selection) {
    cuts.add(clamp(selection.from))
    cuts.add(clamp(selection.to))
  }
  for (const link of links) {
    cuts.add(clamp(link.from))
    cuts.add(clamp(link.to))
  }
  for (const mark of marks) {
    cuts.add(clamp(mark.from))
    cuts.add(clamp(mark.to))
  }
  const markerOffsets = new Map<number, ParagraphFieldMarker[]>()
  for (const marker of markers ?? []) {
    const local = marker.offset - from
    if (local < 0 || local >= text.length) {
      if (local !== text.length || from + local !== paragraphEnd) continue
    }
    cuts.add(local)
    const list = markerOffsets.get(local) ?? []
    list.push(marker)
    markerOffsets.set(local, list)
  }
  const boundaries = [...cuts].sort((a, b) => a - b)
  const nodes: ReactNode[] = []
  const chipsAt = (local: number) =>
    (markerOffsets.get(local) ?? []).map((marker, index) => (
      <FieldMarkerAnchor
        key={`marker-${from + local}-${index}`}
        label={marker.label}
      />
    ))
  nodes.push(...chipsAt(0))
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const a = boundaries[index] ?? 0
    const b = boundaries[index + 1] ?? text.length
    const piece = text.slice(a, b)
    const selected =
      selection !== undefined &&
      from + a >= selection.from &&
      from + b <= selection.to
    const link = links.find(
      (item) => from + a >= item.from && from + b <= item.to,
    )
    const marked = marks.some(
      (item) => from + a >= item.from && from + b <= item.to,
    )
    if (selected || link || marked) {
      nodes.push(
        <span
          key={`part-${a}`}
          data-selected-text={selected ? 'true' : undefined}
          data-link-target={link ? link.target : undefined}
          data-defined-term={marked ? 'pending' : undefined}
          title={link ? link.target : undefined}
          className={
            link
              ? 'rounded-[1px] text-[#2c4a73] underline decoration-[#2c4a73]'
              : marked
                ? 'rounded-[1px] underline decoration-double decoration-[#6a4f8a]'
                : 'rounded-[1px]'
          }
          style={selected ? selectedStyle : undefined}
        >
          {piece}
        </span>,
      )
    } else if (piece.length > 0) {
      nodes.push(piece)
    }
    nodes.push(...chipsAt(b))
  }
  return nodes
}

function FieldMarkerAnchor({ label }: { label: string }) {
  return (
    <span className="relative inline-block w-0">
      <span
        data-field-marker
        aria-hidden="true"
        className="pointer-events-none absolute -top-[1.6em] left-0 z-10 max-w-48 truncate whitespace-nowrap rounded border border-[#7a9cc6] bg-[#eef3fb] px-1 text-[0.6em] leading-4 text-[#2c4a73]"
      >
        {label}
      </span>
    </span>
  )
}

export const selectedStyle = { backgroundColor: '#b8d4f5' }
