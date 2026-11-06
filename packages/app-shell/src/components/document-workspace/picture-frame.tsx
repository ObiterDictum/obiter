import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@obiter/ui'
import {
  PICTURE_MIN_PX,
  draggedPictureSize,
  pictureSizeRefusal,
  type PictureSize,
  type PictureTarget,
} from '../../document-picture-resize'
import { drawingBoxSize } from '../../document-page-media'
import { PageDrawing } from './page-drawing'

type Corner = 'nw' | 'ne' | 'sw' | 'se'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

const CORNER_CLASS = {
  nw: '-top-1 -left-1 cursor-nwse-resize',
  ne: '-top-1 -right-1 cursor-nesw-resize',
  sw: '-bottom-1 -left-1 cursor-nesw-resize',
  se: '-bottom-1 -right-1 cursor-nwse-resize',
} satisfies Record<Corner, string>

const CORNER_LABEL = {
  nw: 'top left',
  ne: 'top right',
  sw: 'bottom left',
  se: 'bottom right',
} satisfies Record<Corner, string>

export type PictureInteraction = {
  selectedRunId: string | null
  lockRatio: boolean
  unavailable?: string
  onSelect: (target: PictureTarget, columnWidthPx: number) => void
  onClear: () => void
  onResize: (target: PictureTarget, size: PictureSize) => void
}

export function paintedPictureSize(runId: string): PictureSize | undefined {
  const node = document.querySelector(`[data-picture-run-id="${runId}"]`)
  if (!(node instanceof HTMLElement)) return undefined
  const widthPx = Number.parseFloat(node.style.width)
  const heightPx = Number.parseFloat(node.style.height)
  if (!(widthPx > 0) || !(heightPx > 0)) return undefined
  return { widthPx, heightPx }
}

type Drag = {
  corner: Corner
  startX: number
  startY: number
  from: PictureSize
  size: PictureSize
}

function signedDelta(corner: Corner, dx: number, dy: number) {
  const horizontal = corner === 'ne' || corner === 'se' ? dx : -dx
  const vertical = corner === 'sw' || corner === 'se' ? dy : -dy
  return { deltaX: horizontal, deltaY: vertical }
}

export function PictureFrame({
  xml,
  imageUrl,
  fallbackLabel,
  paragraphId,
  runId,
  columnWidthPx,
  interaction,
}: {
  xml: string
  imageUrl?: string
  fallbackLabel: string
  paragraphId: string
  runId: string
  columnWidthPx: number
  interaction?: PictureInteraction | undefined
}) {
  const box = drawingBoxSize(xml)
  const actual: PictureSize = { widthPx: box.width, heightPx: box.height }
  const maxWidthPx = Math.max(
    PICTURE_MIN_PX,
    columnWidthPx > 0 ? columnWidthPx : actual.widthPx,
  )
  const selected = interaction?.selectedRunId === runId
  const refusal = interaction?.unavailable ?? pictureSizeRefusal(xml)
  const [drag, setDrag] = useState<Drag | null>(null)
  const latestDrag = useRef<Drag | null>(null)
  const shown = drag?.size ?? actual
  const scaleX = shown.widthPx / actual.widthPx
  const scaleY = shown.heightPx / actual.heightPx

  const begin = (corner: Corner, event: ReactPointerEvent<HTMLElement>) => {
    if (!interaction || refusal) return
    event.preventDefault()
    event.stopPropagation()
    const start: Drag = {
      corner,
      startX: event.clientX,
      startY: event.clientY,
      from: actual,
      size: actual,
    }
    latestDrag.current = start
    setDrag(start)
    const move = (moveEvent: PointerEvent) => {
      const current = latestDrag.current
      if (!current) return
      const { deltaX, deltaY } = signedDelta(
        current.corner,
        moveEvent.clientX - current.startX,
        moveEvent.clientY - current.startY,
      )
      const size = draggedPictureSize({
        from: current.from,
        deltaX,
        deltaY,
        lockRatio: interaction.lockRatio && !moveEvent.shiftKey,
        columnWidthPx: maxWidthPx,
      })
      const next = { ...current, size }
      latestDrag.current = next
      setDrag(next)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      const current = latestDrag.current
      latestDrag.current = null
      setDrag(null)
      if (!current) return
      interaction.onResize({ paragraphId, runId }, current.size)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  if (!interaction) {
    return (
      <PageDrawing
        xml={xml}
        imageUrl={imageUrl}
        fallbackLabel={fallbackLabel}
      />
    )
  }

  return (
    <div
      data-picture-run-id={runId}
      data-picture-selected={selected ? 'true' : undefined}
      data-picture-max-width-px={maxWidthPx}
      role="group"
      aria-label="Picture"
      className={cn('relative inline-block align-bottom', selected && 'z-10')}
      style={{ width: shown.widthPx, height: shown.heightPx }}
      onClick={(event) => {
        event.stopPropagation()
        interaction.onSelect({ paragraphId, runId }, columnWidthPx)
      }}
    >
      <div
        className={cn(selected && 'outline outline-1 outline-[#2c4a73]')}
        style={{
          width: actual.widthPx,
          height: actual.heightPx,
          transform:
            scaleX === 1 && scaleY === 1
              ? undefined
              : `scale(${String(scaleX)}, ${String(scaleY)})`,
          transformOrigin: 'top left',
        }}
      >
        <PageDrawing
          xml={xml}
          imageUrl={imageUrl}
          fallbackLabel={fallbackLabel}
        />
      </div>
      {selected
        ? CORNERS.map((corner) => (
            <span
              key={corner}
              data-picture-handle={corner}
              data-print-hide
              aria-hidden="true"
              className={cn(
                'absolute z-20 h-2 w-2 border border-[#2c4a73] bg-white',
                CORNER_CLASS[corner],
                refusal ? 'cursor-not-allowed' : '',
              )}
              title={`Resize picture from the ${CORNER_LABEL[corner]}`}
              onPointerDown={
                refusal ? undefined : (event) => begin(corner, event)
              }
            />
          ))
        : null}
    </div>
  )
}
