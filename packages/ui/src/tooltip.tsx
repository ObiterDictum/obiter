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
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={8} className="z-50">
        <BaseTooltip.Popup
          className={cn(
            'max-w-xs rounded-md bg-raised px-3 py-2 text-caption text-ink shadow-lg inset-ring-1 inset-ring-line',
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
