import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export interface SidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Header affordance, usually a close button. */
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * SidePanel — a right-hand panel over the page (details, versions, changes).
 *
 * Built on Base UI Dialog rather than a bare aside: a panel that covers content
 * needs a focus trap, Escape to dismiss and focus returned to its opener, and
 * those are the parts Base UI already gets right. The screen owns `open`, the
 * title and any close control, so the panel itself stays presentational.
 */
export function SidePanel({
  open,
  onOpenChange,
  title,
  action,
  footer,
  children,
  className,
}: SidePanelProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-overlay" />
        <BaseDialog.Popup
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-panel max-w-full flex-col border-l border-line bg-surface text-ink shadow-lg outline-none',
            'transition-transform duration-150 ease-out motion-reduce:transition-none',
            'data-[starting-style]:translate-x-2 data-[ending-style]:translate-x-2',
            className,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
            <BaseDialog.Title className="text-item text-ink">
              {title}
            </BaseDialog.Title>
            {action}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 text-body">
            {children}
          </div>
          {footer ? (
            <div className="shrink-0 border-t border-line px-6 py-3">
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
