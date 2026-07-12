import { Progress as BaseProgress } from '@base-ui-components/react/progress'
import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export interface ProgressBarProps {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number
  label?: ReactNode
  helperText?: ReactNode
  className?: string
}

/**
 * ProgressBar — a calm indicator of a known or indeterminate operation.
 * Built on Base UI Progress; pass `value` for determinate, omit for indeterminate.
 */
export function ProgressBar({
  value,
  label,
  helperText,
  className,
}: ProgressBarProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label || helperText ? (
        <div className="flex items-baseline justify-between">
          {label ? (
            <span className="text-sm font-medium text-ink">{label}</span>
          ) : null}
          {helperText ? (
            <span className="text-xs text-muted">{helperText}</span>
          ) : null}
        </div>
      ) : null}
      <BaseProgress.Root
        value={value ?? null}
        max={100}
        className="h-2 w-full overflow-hidden rounded-pill bg-line"
      >
        <BaseProgress.Track className="h-full">
          <BaseProgress.Indicator className="h-full rounded-pill bg-brand transition-[width] duration-300" />
        </BaseProgress.Track>
      </BaseProgress.Root>
    </div>
  )
}
