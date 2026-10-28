import { cn } from '@obiter/ui'
import type { ReactNode } from 'react'

export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
  icon?: ReactNode
}

/**
 * A segmented control for choosing one of a few mutually exclusive settings:
 * the sign-in method and the theme. Plain pressed buttons inside a labelled
 * group, because both are filters on a form rather than tabbed panels — there
 * is no panel to point `aria-controls` at.
 */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: Value
  options: SegmentedOption<Value>[]
  onChange: (value: Value) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md bg-fill p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1 rounded-sm px-2 text-caption whitespace-nowrap',
              'transition-[color,background-color,box-shadow] duration-150',
              // Same raised, outlined selection as TabsTrigger: in dark the
              // raised surface is darker than the fill, so the outline carries
              // the state.
              active
                ? 'bg-raised font-medium text-ink shadow-sm ring-1 ring-brand/40'
                : 'text-subtle hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
