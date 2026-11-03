import { ContextMenu as BaseContextMenu } from '@base-ui-components/react/context-menu'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from './lib/cn'

export function ContextMenu(
  props: ComponentPropsWithoutRef<typeof BaseContextMenu.Root>,
) {
  return <BaseContextMenu.Root {...props} />
}

export function ContextMenuTrigger(
  props: ComponentPropsWithoutRef<typeof BaseContextMenu.Trigger>,
) {
  return <BaseContextMenu.Trigger {...props} />
}

export function ContextMenuContent({
  className,
  align = 'start',
  ...props
}: ComponentPropsWithoutRef<typeof BaseContextMenu.Popup> & {
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner sideOffset={4} align={align} className="z-50">
        <BaseContextMenu.Popup
          className={cn(
            'w-56 rounded-lg border border-line bg-raised p-2 text-ink shadow-lg outline-none',
            'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            'data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

export function ContextMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseContextMenu.Item>) {
  return (
    <BaseContextMenu.Item
      className={cn(
        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted select-none',
        'pointer-coarse:min-h-11',
        'data-[highlighted]:bg-hover data-[highlighted]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseContextMenu.Separator>) {
  return (
    <BaseContextMenu.Separator
      className={cn('my-1 h-px bg-line', className)}
      {...props}
    />
  )
}
