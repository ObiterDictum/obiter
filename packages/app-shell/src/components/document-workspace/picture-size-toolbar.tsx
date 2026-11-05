import { useLayoutEffect, useState } from 'react'
import { cn } from '@obiter/ui'
import type { PictureSize } from '../../document-picture-resize'

export type PictureSizeControl = {
  runId: string
  columnWidthPx: number
  lockRatio: boolean
  resized: boolean
  unavailable?: string
  onLockRatio: (value: boolean) => void
  onResize: (size: PictureSize) => void
  onReset: () => void
}

const PX_PER_CM = 96 / 2.54

function centimetresText(px: number) {
  return (px / PX_PER_CM).toFixed(2)
}

function parseCentimetres(text: string) {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value * PX_PER_CM : undefined
}

type Placement = { left: number; top: number } & PictureSize

export function PictureSizeToolbar({
  control,
}: {
  control: PictureSizeControl | undefined
}) {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const runId = control?.runId
  useLayoutEffect(() => {
    if (!runId) {
      setPlacement(null)
      return
    }
    const place = () => {
      const picture = document.querySelector(`[data-picture-run-id="${runId}"]`)
      if (!(picture instanceof HTMLElement)) return
      const rect = picture.getBoundingClientRect()
      const widthPx = Number.parseFloat(picture.style.width) || rect.width
      const heightPx = Number.parseFloat(picture.style.height) || rect.height
      if (!(widthPx > 0) || !(heightPx > 0)) return
      setPlacement({
        left: Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - 288)),
        top: Math.max(56, rect.top - 12),
        widthPx,
        heightPx,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [runId, control?.resized])
  if (!control) return null
  const size = placement ?? { widthPx: 0, heightPx: 0 }
  const ratio = size.widthPx / size.heightPx
  const disabled = control.unavailable !== undefined
  const commit = (axis: 'width' | 'height', text: string) => {
    const centimetres = parseCentimetres(text)
    if (centimetres === undefined || disabled || !(ratio > 0)) return
    const next =
      axis === 'width'
        ? {
            widthPx: centimetres,
            heightPx: control.lockRatio ? centimetres / ratio : size.heightPx,
          }
        : {
            widthPx: control.lockRatio ? centimetres * ratio : size.widthPx,
            heightPx: centimetres,
          }
    if (
      Math.abs(next.widthPx - size.widthPx) < 1 &&
      Math.abs(next.heightPx - size.heightPx) < 1
    ) {
      return
    }
    control.onResize(next)
  }
  const fieldKey = `${control.runId}:${String(Math.round(size.widthPx))}:${String(Math.round(size.heightPx))}`
  const field = (axis: 'width' | 'height') => (
    <label className="flex flex-1 items-center gap-1">
      <span className="text-muted">
        {axis === 'width' ? 'Width' : 'Height'}
      </span>
      <input
        key={`${axis}:${fieldKey}`}
        aria-label={`Picture ${axis} in centimetres`}
        type="number"
        step="0.1"
        min="0.4"
        defaultValue={centimetresText(
          axis === 'width' ? size.widthPx : size.heightPx,
        )}
        disabled={disabled}
        className="w-16 rounded border border-line bg-transparent px-1 py-0.5"
        onBlur={(event) => commit(axis, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(axis, event.currentTarget.value)
        }}
      />
      <span className="text-muted">cm</span>
    </label>
  )
  return (
    <div
      role="group"
      aria-label="Picture size"
      data-print-hide
      data-picture-size
      className={cn(
        'fixed z-30 w-64 rounded-md border border-line bg-raised p-2 text-[12px] shadow-lg',
        placement ? '' : 'top-16 left-2',
      )}
      style={placement ?? undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-1">
        {field('width')}
        {field('height')}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label="Lock aspect ratio"
            checked={control.lockRatio}
            disabled={disabled}
            onChange={(event) => control.onLockRatio(event.target.checked)}
          />
          <span>Lock aspect ratio</span>
        </label>
        <button
          type="button"
          className="rounded border border-line px-1.5 py-0.5 disabled:opacity-50"
          disabled={disabled || !control.resized}
          onClick={control.onReset}
        >
          Reset to original size
        </button>
      </div>
      {control.unavailable ? (
        <p className="mt-1 text-[#8a3d2a]" role="status">
          {control.unavailable}
        </p>
      ) : null}
    </div>
  )
}
