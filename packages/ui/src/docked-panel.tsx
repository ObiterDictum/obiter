import { X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Button } from './button'
import { cn } from './lib/cn'

export interface DockedPanelProps {
  /** Becomes the region's accessible name; a string is used verbatim. */
  title: ReactNode
  /** Accessible name of the close control, when the title is not a string. */
  titleText?: string
  onClose: () => void
  /** Header affordance beside the close control, such as a count. */
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * DockedPanel — a beside-the-paper panel for the document workspace.
 *
 * Unlike `SidePanel` it is not modal: the page stays visible and editable, so
 * there is no backdrop, no focus trap and no portal. Escape and returning focus
 * to the trigger belong to the screen that owns the trigger, because a
 * non-modal panel must not move focus on open. The region is labelled so it is
 * reachable by landmark, and every close path routes through `onClose`.
 */
export function DockedPanel({
  title,
  titleText,
  onClose,
  action,
  footer,
  children,
  className,
}: DockedPanelProps) {
  const name = titleText ?? (typeof title === 'string' ? title : undefined)
  return (
    <aside
      data-docked-panel
      aria-label={name}
      className={cn(
        'flex w-panel max-w-full min-w-0 shrink-0 flex-col bg-surface text-ink',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-6 py-3">
        <h2 className="text-item text-ink">{title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {action}
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
