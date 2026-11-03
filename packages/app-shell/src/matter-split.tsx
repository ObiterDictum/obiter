import { ArrowsOutSimple } from '@obiter/ui/icons'
import type { AppPlatform } from '@obiter/contracts'
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { useMatterTabs } from './matter-tabs-state'

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

export function MatterTabsPane({
  platform,
  compact,
  children,
}: {
  platform: AppPlatform
  compact: boolean
  children: ReactNode
}) {
  const { sideId, openToSide, closeSide } = useMatterTabs()
  const [split, setSplit] = useState(56)
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
      <div className="relative flex min-h-0 flex-1">
        <div
          className="min-h-0 min-w-0 overflow-y-auto"
          style={sideId ? { flex: `0 0 ${String(split)}%` } : { flex: 1 }}
        >
          {children}
        </div>
        {sideId ? (
          <>
            <SplitDivider onResize={setSplit} />
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
            <span className="flex items-center gap-2 rounded-md bg-surface px-3 py-1.5 shadow-sm">
              <ArrowsOutSimple size={14} aria-hidden />
              Open to the side
            </span>
          </button>
        ) : null}
      </div>
    </>
  )
}

function SplitDivider({ onResize }: { onResize: (percent: number) => void }) {
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
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        resize(event.clientX, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onResize(event.key === 'ArrowLeft' ? MIN_SPLIT + 10 : MAX_SPLIT - 10)
      }}
      className="w-1 shrink-0 cursor-col-resize bg-line transition-colors duration-150 hover:bg-brand focus-visible:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    />
  )
}
