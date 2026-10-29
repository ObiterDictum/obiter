import { X, ArrowsInSimple, ArrowsOutSimple } from '@phosphor-icons/react'
import { useRef, type ReactNode } from 'react'
import { Button } from './button'
import { cn } from './lib/cn'

export type PanelPosition = { x: number; y: number }

export interface PanelPopout {
  mode: 'docked' | 'floating'
  position: PanelPosition
  onToggle: () => void
  onMove: (position: PanelPosition) => void
  canFloat: boolean
  minTop?: number
}

export interface DockedPanelProps {
  title: ReactNode
  titleText?: string
  onClose: () => void
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  popout?: PanelPopout
}

export function clampPanelPosition(
  position: PanelPosition,
  viewport: { width: number; height: number },
  panel: { width: number; height: number },
  minTop = 8,
): PanelPosition {
  const maxX = Math.max(8, viewport.width - panel.width - 8)
  const maxY = Math.max(minTop, viewport.height - panel.height - 8)
  return {
    x: Math.min(Math.max(8, Math.round(position.x)), maxX),
    y: Math.min(Math.max(minTop, Math.round(position.y)), maxY),
  }
}

export function DockedPanel({
  title,
  titleText,
  onClose,
  action,
  footer,
  children,
  className,
  popout,
}: DockedPanelProps) {
  const name = titleText ?? (typeof title === 'string' ? title : undefined)
  const panelRef = useRef<HTMLElement>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: PanelPosition
  } | null>(null)
  const floating = popout?.mode === 'floating'
  const move = (next: PanelPosition) => {
    if (!popout) return
    const rect = panelRef.current?.getBoundingClientRect()
    popout.onMove(
      clampPanelPosition(
        next,
        { width: innerWidth, height: innerHeight },
        {
          width: rect?.width ?? 380,
          height: rect?.height ?? 480,
        },
        popout.minTop,
      ),
    )
  }
  return (
    <aside
      ref={panelRef}
      data-docked-panel
      data-panel-mode={floating ? 'floating' : 'docked'}
      aria-label={name}
      style={
        floating
          ? { left: popout.position.x, top: popout.position.y }
          : undefined
      }
      className={cn(
        'flex w-panel max-w-full min-w-0 shrink-0 flex-col bg-surface text-ink',
        floating &&
          'fixed z-40 max-h-[calc(100vh-16px)] rounded-lg border border-line shadow-xl',
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b border-line px-6 py-3',
          floating &&
            'cursor-grab touch-none select-none active:cursor-grabbing',
        )}
        {...(floating
          ? {
              onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
                // SAFETY: pointer events from this header always target an
                if ((event.target as HTMLElement).closest('button')) return
                drag.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: popout.position,
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              },
              onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                const state = drag.current
                if (!state || state.pointerId !== event.pointerId) return
                move({
                  x: state.origin.x + event.clientX - state.startX,
                  y: state.origin.y + event.clientY - state.startY,
                })
              },
              onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
                if (drag.current?.pointerId !== event.pointerId) return
                drag.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
              },
              onPointerCancel: () => {
                drag.current = null
              },
            }
          : {})}
      >
        <div
          {...(floating
            ? {
                tabIndex: 0,
                role: 'group',
                'aria-label': `Move ${name ?? 'panel'} panel: arrow keys move it, Shift moves further`,
                className:
                  'min-w-0 rounded-sm text-item text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                  const step = event.shiftKey ? 64 : 16
                  const delta =
                    event.key === 'ArrowLeft'
                      ? { x: -step, y: 0 }
                      : event.key === 'ArrowRight'
                        ? { x: step, y: 0 }
                        : event.key === 'ArrowUp'
                          ? { x: 0, y: -step }
                          : event.key === 'ArrowDown'
                            ? { x: 0, y: step }
                            : null
                  if (!delta) return
                  event.preventDefault()
                  move({
                    x: popout.position.x + delta.x,
                    y: popout.position.y + delta.y,
                  })
                },
              }
            : { className: 'min-w-0' })}
        >
          <h2 className="truncate text-item text-ink">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {popout?.canFloat ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-caption pointer-coarse:min-h-11"
              aria-label={
                floating
                  ? `Dock ${name ?? 'panel'}`
                  : `Pop out ${name ?? 'panel'}`
              }
              aria-pressed={floating}
              onClick={popout.onToggle}
              iconStart={
                floating ? (
                  <ArrowsInSimple size={14} aria-hidden />
                ) : (
                  <ArrowsOutSimple size={14} aria-hidden />
                )
              }
            >
              <span className="max-compact:sr-only">
                {floating ? 'Dock' : 'Pop out'}
              </span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="size-7 px-0 pointer-coarse:size-11"
            aria-label={name ? `Close ${name}` : 'Close panel'}
            onClick={onClose}
            iconStart={<X size={14} aria-hidden />}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-body">
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-line px-6 py-3">{footer}</div>
      ) : null}
    </aside>
  )
}
