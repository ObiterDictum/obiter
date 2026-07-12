import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { cn } from './lib/cn'

type Size = 'sm' | 'md' | 'lg'

const sizeClasses: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

/**
 * Dialog — a styled compound over Base UI Dialog. Focus trap, escape, and
 * backdrop behaviour come from Base UI; we own the visual layer.
 *
 *   <Dialog>
 *     <DialogTrigger render={<Button>Open</Button>} />
 *     <DialogContent size="md">
 *       <DialogTitle>Title</DialogTitle>
 *       <DialogDescription>Body copy.</DialogDescription>
 *       <DialogClose render={<Button>Close</Button>} />
 *     </DialogContent>
 *   </Dialog>
 */
export function Dialog(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Root>,
) {
  return <BaseDialog.Root {...props} />
}

export function DialogTrigger(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Trigger>,
) {
  return <BaseDialog.Trigger {...props} />
}

export interface DialogContentProps {
  children: ReactNode
  size?: Size
  className?: string
}

export function DialogContent({
  children,
  size = 'md',
  className,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-overlay" />
      <BaseDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 p-6',
          'rounded-lg border border-line bg-raised shadow-lg outline-none',
          sizeClasses[size],
          className,
        )}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function DialogTitle(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Title>,
) {
  return (
    <BaseDialog.Title
      className="mb-1 text-lg font-semibold text-ink"
      {...props}
    />
  )
}

export function DialogDescription(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Description>,
) {
  return (
    <BaseDialog.Description
      className="mb-4 text-sm leading-relaxed text-muted"
      {...props}
    />
  )
}

export function DialogClose(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Close>,
) {
  return <BaseDialog.Close {...props} />
}

/** A header-affordance close button for dialog corners. */
export function DialogCloseButton() {
  return (
    <BaseDialog.Close
      aria-label="Close"
      className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-surface hover:text-ink"
    >
      <X size={18} aria-hidden="true" />
    </BaseDialog.Close>
  )
}
