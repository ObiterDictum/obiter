import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from './lib/cn'

/**
 * Tooltip — a styled compound over Base UI Tooltip. Hover/focus + positioning
 * from Base UI. Keep tooltips for supplementary labels, never for primary info.
 *
 *   <Tooltip>
 *     <TooltipTrigger render={<button>…</button>} />
 *     <TooltipContent>Helpful context</TooltipContent>
 *   </Tooltip>
 */
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
  /** Preferred side. Base UI still flips it when the popup would not fit. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={8} className="z-50">
        <BaseTooltip.Popup
          // rc.0 leaves the popup's role to the caller.
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
