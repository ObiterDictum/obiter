import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from './lib/cn'

export function Tooltip(
  props: ComponentPropsWithoutRef<typeof BaseTooltip.Root>,
) {
  return <BaseTooltip.Root {...props} />
}

export function TooltipTrigger(
  props: ComponentPropsWithoutRef<typeof BaseTooltip.Trigger>,
) {
  return <BaseTooltip.Trigger {...props} />
}

export function TooltipContent({
  children,
  className,
  side = 'top',
}: {
  children: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={8} className="z-50">
        <BaseTooltip.Popup
          role="tooltip"
          className={cn(
            'max-w-xs rounded-md border border-line bg-raised px-3 py-2 text-caption text-ink shadow-lg',
            'outline-none',
            className,
          )}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}
