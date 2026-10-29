import { Switch as BaseSwitch } from '@base-ui-components/react/switch'
import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
  className,
  children,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <BaseSwitch.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        'inline-flex items-center gap-2 rounded-pill px-2 py-1 text-caption text-muted select-none',
        'hover:bg-hover hover:text-ink data-[checked]:bg-brand-soft data-[checked]:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-pill transition-colors duration-150',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-pill bg-surface-raised transition-[left] duration-150',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
      {children}
    </BaseSwitch.Root>
  )
}
