import type { AppPlatform } from '@obiter/contracts'
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { useMatterPreviewRef } from './matter-preview'
import { SPLIT_DIVIDER_WIDTH, SplitScaleProvider } from './matter-split-scale'
import {
  MatterTabsProvider,
  useHydrateMatterTabs,
  useMatterTabs,
} from './matter-tabs-state'

const MatterTabStrip = lazy(() =>
  import('./matter-tab-strip').then((module) => ({
    default: module.MatterTabStrip,
  })),
)

const MatterSplitSide = lazy(() =>
  import('./matter-split-side').then((module) => ({
    default: module.MatterSplitSide,
  })),
)

const MIN_SPLIT = 30
const MAX_SPLIT = 72
const EVEN_SPLIT = 50

export function MatterTabsPane({
  matterId,
  userId,
  platform,
  compact,
  children,
}: {
  matterId: string
  userId: string
  platform: AppPlatform
  compact: boolean
  children: ReactNode
}) {
  return (
    <MatterTabsProvider key={matterId} userId={userId} matterId={matterId}>
      <MatterTabsPaneBody platform={platform} compact={compact}>
        {children}
      </MatterTabsPaneBody>
    </MatterTabsProvider>
  )
}

function MatterTabsPaneBody({
  platform,
  compact,
  children,
}: {
  platform: AppPlatform
  compact: boolean
  children: ReactNode
}) {
  useHydrateMatterTabs()
  const { sideId, openToSide, closeSide, openPreview } = useMatterTabs()
  const previewRef = useMatterPreviewRef()
  useEffect(() => {
    if (!previewRef) return
    previewRef.current = openPreview
    return () => {
      previewRef.current = null
    }
  })
  const [split, setSplit] = useState(EVEN_SPLIT)
  const [zoom, setZoom] = useState(100)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  return (
    <>
      <Suspense fallback={null}>
        <MatterTabStrip
          platform={platform}
          compact={compact}
          onTabDrag={setDraggingId}
        />
      </Suspense>
      <SplitScaleProvider active={Boolean(sideId)} zoom={zoom} onZoom={setZoom}>
        <div className="relative flex min-h-0 flex-1">
          <div
            className="min-h-0 min-w-0 overflow-y-auto"
            style={
              sideId
                ? {
                    flex: `0 0 calc(${String(split)}% - ${String(
                      SPLIT_DIVIDER_WIDTH / 2,
                    )}px)`,
                  }
                : { flex: 1 }
            }
          >
            {children}
          </div>
          {sideId ? (
            <>
              <SplitDivider split={split} onResize={setSplit} />
              <Suspense fallback={null}>
                <MatterSplitSide sideId={sideId} onClose={closeSide} />
              </Suspense>
            </>
          ) : null}
          {draggingId ? (
            <button
              type="button"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                openToSide(draggingId)
                setDraggingId(null)
              }}
              className="absolute inset-y-0 right-0 z-20 flex w-44 items-center justify-center border-l-2 border-dashed border-brand bg-brand-soft text-meta text-brand"
            >
              <span className="rounded-md bg-surface px-3 py-1.5 shadow-sm">
                Open to the side
              </span>
            </button>
          ) : null}
        </div>
      </SplitScaleProvider>
    </>
  )
}

function SplitDivider({
  split,
  onResize,
}: {
  split: number
  onResize: (percent: number) => void
}) {
  function resize(clientX: number, element: HTMLElement) {
    const parent = element.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    if (rect.width === 0) return
    const percent = ((clientX - rect.left) / rect.width) * 100
    onResize(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent)))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split view"
      aria-valuenow={Math.round(split)}
      aria-valuemin={MIN_SPLIT}
      aria-valuemax={MAX_SPLIT}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onDoubleClick={() => onResize(EVEN_SPLIT)}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        resize(event.clientX, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onResize(event.key === 'ArrowLeft' ? MIN_SPLIT + 10 : MAX_SPLIT - 10)
      }}
      style={{ width: SPLIT_DIVIDER_WIDTH }}
      className="shrink-0 cursor-col-resize bg-line transition-colors duration-150 hover:bg-brand focus-visible:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    />
  )
}
