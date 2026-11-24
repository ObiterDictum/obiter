import { useSplitScale } from '@obiter/app-shell'
import { Button } from '@obiter/ui'

export const REVIEW_PAGE_ZOOM_MIN = 25
export const REVIEW_PAGE_ZOOM_MAX = 400

export function stepReviewZoom(zoom: number, delta: number) {
  return Math.max(1, zoom + delta)
}

export function zoomLevelForPagePercent(fit: number, percent: number) {
  if (!(fit > 0)) return Math.max(1, percent)
  return Math.max(1, Math.ceil(percent / fit))
}

export function ReviewZoomControls() {
  const scale = useSplitScale()
  if (!scale) return null
  const { zoom, pageZoom, fit, onZoom } = scale
  const atFit = zoom === 100
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Zoom page"
    >
      <Button
        size="sm"
        variant={atFit ? 'secondary' : 'ghost'}
        aria-pressed={atFit}
        onClick={() => onZoom(100)}
      >
        Fit width
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 px-0"
        aria-label="Zoom out"
        disabled={pageZoom <= REVIEW_PAGE_ZOOM_MIN}
        onClick={() => onZoom(stepReviewZoom(zoom, -10))}
      >
        −
      </Button>
      <span className="w-10 text-center text-caption tabular-nums text-muted">
        {pageZoom}%
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 px-0"
        aria-label="Zoom in"
        disabled={pageZoom >= REVIEW_PAGE_ZOOM_MAX}
        onClick={() => onZoom(stepReviewZoom(zoom, 10))}
      >
        +
      </Button>
      <Button
        size="sm"
        variant={pageZoom === 100 ? 'secondary' : 'ghost'}
        aria-pressed={pageZoom === 100}
        aria-label="Zoom to 100%"
        onClick={() => onZoom(zoomLevelForPagePercent(fit, 100))}
      >
        100%
      </Button>
    </div>
  )
}
