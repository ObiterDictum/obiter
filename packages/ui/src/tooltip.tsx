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
export function Tooltip(props: ComponentPropsWithoutRef<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root {...props} />
}

export function TooltipTrigger(props: ComponentPropsWithoutRef<typeof BaseTooltip.Trigger>) {
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
      <BaseTooltip.Positioner sideOffset={6} className="z-50">
        <BaseTooltip.Popup
          className={cn(
            'max-w-xs rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-xs text-ink shadow-md',
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
