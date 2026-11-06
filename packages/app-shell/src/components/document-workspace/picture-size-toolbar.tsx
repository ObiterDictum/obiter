import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, cn } from '@obiter/ui'
import {
  centimetresFromPx,
  pxFromCentimetres,
  type PictureSize,
} from '../../document-picture-resize'
import { pictureSizeToolbarPlacement } from './picture-size-toolbar-placement'
import { useLatestCallback } from './use-latest-callback'

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

function centimetresText(px: number) {
  return centimetresFromPx(px).toFixed(2)
}

function parseCentimetres(text: string) {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0
    ? pxFromCentimetres(value)
    : undefined
}

type Placement = { left: number; top: number } & PictureSize

export function PictureSizeToolbar({
  control,
}: {
  control: PictureSizeControl | undefined
}) {
  const toolbar = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const runId = control?.runId
  const place = useLatestCallback(() => {
    if (!runId) {
      setPlacement(null)
      return
    }
    const picture = document.querySelector(`[data-picture-run-id="${runId}"]`)
    const panel = toolbar.current
    if (!(picture instanceof HTMLElement) || !panel) return
    const rect = picture.getBoundingClientRect()
    const widthPx = Number.parseFloat(picture.style.width) || rect.width
    const heightPx = Number.parseFloat(picture.style.height) || rect.height
    if (!(widthPx > 0) || !(heightPx > 0)) return
    const page = picture
      .closest('[data-document-sheet]')
      ?.getBoundingClientRect()
    const at = pictureSizeToolbarPlacement({
      picture: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      panel: { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: { width: innerWidth, height: innerHeight },
      page: page
        ? {
            left: page.left,
            top: page.top,
            right: page.right,
            bottom: page.bottom,
          }
        : undefined,
    })
    setPlacement((current) =>
      current &&
      current.left === at.left &&
      current.top === at.top &&
      current.widthPx === widthPx &&
      current.heightPx === heightPx
        ? current
        : { ...at, widthPx, heightPx },
    )
  })
  useLayoutEffect(() => {
    place()
  })
  useLayoutEffect(() => {
    if (!runId) return
    const reposition = () => place()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [runId, place])
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
    <label className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted">
        {axis === 'width' ? 'Width' : 'Height'}
      </span>
      <Input
        key={`${axis}:${fieldKey}`}
        aria-label={`Picture ${axis} in centimetres`}
        type="number"
        step="0.1"
        min="0.4"
        defaultValue={centimetresText(
          axis === 'width' ? size.widthPx : size.heightPx,
        )}
        disabled={disabled}
        className="w-20"
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
      ref={toolbar}
      role="group"
      aria-label="Picture size"
      data-print-hide
      data-picture-size
      className={cn(
        'fixed z-30 flex w-max max-w-[calc(100vw-16px)] flex-col gap-1.5 rounded-md border border-line bg-raised px-2 py-1.5 text-caption shadow-lg',
        placement ? '' : 'top-16 left-2',
      )}
      style={placement ?? undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {field('width')}
        {field('height')}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label className="flex items-center gap-1 whitespace-nowrap">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-brand"
            aria-label="Lock aspect ratio"
            checked={control.lockRatio}
            disabled={disabled}
            onChange={(event) => control.onLockRatio(event.target.checked)}
          />
          <span>Lock aspect ratio</span>
        </label>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={disabled || !control.resized}
          onClick={control.onReset}
        >
          Reset to original size
        </Button>
      </div>
      {control.unavailable ? (
        <p className="text-[#8a3d2a]" role="status">
          {control.unavailable}
        </p>
      ) : null}
    </div>
  )
}
