import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { X } from './icons'
import { cn } from './lib/cn'

type Size = 'sm' | 'md' | 'lg'

type DialogSurface = 'dialog' | 'palette'

const surfaceClasses = {
  dialog:
    'top-1/2 max-h-[calc(100dvh-var(--obiter-space-48))] w-[calc(100%-var(--obiter-space-48))] -translate-y-1/2 overflow-y-auto rounded-lg p-6',
  palette:
    'top-[var(--obiter-palette-offset)] max-h-[calc(100dvh-var(--obiter-space-56))] w-[min(var(--obiter-palette-width),calc(100%-var(--obiter-space-32)))] overflow-hidden rounded-xl',
} satisfies Record<DialogSurface, string>

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} satisfies Record<Size, string>

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
  surface?: DialogSurface
  className?: string
  initialFocus?: ComponentPropsWithoutRef<
    typeof BaseDialog.Popup
  >['initialFocus']
}

export function DialogContent({
  children,
  size = 'md',
  surface = 'dialog',
  className,
  initialFocus,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-overlay" />
      <BaseDialog.Popup
        initialFocus={initialFocus}
        className={cn(
          'fixed left-1/2 z-50 -translate-x-1/2 border border-line bg-raised shadow-lg outline-none',
          surfaceClasses[surface],
          sizeClasses[size],
          className,
        )}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn('mb-2 text-section text-ink', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn('mb-6 text-body text-muted', className)}
      {...props}
    />
  )
}

export function DialogFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('mt-6 flex items-center justify-end gap-2', className)}
      {...props}
    />
  )
}

export function DialogClose(
  props: ComponentPropsWithoutRef<typeof BaseDialog.Close>,
) {
  return <BaseDialog.Close {...props} />
}

export function DialogCloseButton() {
  return (
    <BaseDialog.Close
      aria-label="Close"
      className="absolute right-4 top-4 rounded-sm p-1 text-muted hover:bg-hover hover:text-ink"
    >
      <X size={16} aria-hidden="true" />
    </BaseDialog.Close>
  )
}
