import { Popover as BasePopover } from '@base-ui-components/react/popover'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from './lib/cn'

export function Popover(
  props: ComponentPropsWithoutRef<typeof BasePopover.Root>,
) {
  return <BasePopover.Root {...props} />
}

export function PopoverPortal({ children }: { children: ReactNode }) {
  return <BasePopover.Portal>{children}</BasePopover.Portal>
}

export function PopoverPositioner({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BasePopover.Positioner>) {
  return (
    <BasePopover.Positioner
      className={cn('z-40', className)}
      collisionAvoidance={{ side: 'flip', align: 'shift' }}
      collisionPadding={12}
      sticky
      {...props}
    />
  )
}

export function PopoverPopup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BasePopover.Popup>) {
  return (
    <BasePopover.Popup
      className={cn(
        'rounded-lg border border-line bg-raised text-body text-ink shadow-lg outline-none',
        'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
        'data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0',
        'data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}
