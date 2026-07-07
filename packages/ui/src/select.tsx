import { Select as BaseSelect } from '@base-ui-components/react/select'
import type { ReactNode } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from './lib/cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string | null) => void
  placeholder?: string
  label?: ReactNode
  invalid?: boolean
  name?: string
  disabled?: boolean
  className?: string
}

function optionLabel(options: SelectOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

/**
 * Select — a labeled dropdown built on Base UI Select (keyboard, focus,
 * positioning). Single-value; value is string.
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select…',
  label,
  invalid,
  name,
  disabled,
  className,
}: SelectProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? <span className="text-sm font-medium text-ink">{label}</span> : null}
      <BaseSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        onValueChange={(next) => onValueChange?.(next ?? null)}
        items={options}
      >
        <BaseSelect.Trigger
          className={cn(
            'inline-flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 text-sm text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            'disabled:cursor-not-allowed disabled:opacity-60 data-[popup-open]:border-brand',
            invalid ? 'border-danger' : 'border-line hover:border-line-strong',
          )}
        >
          <BaseSelect.Value>
            {(value: string | null) =>
              value ? (
                optionLabel(options, value)
              ) : (
                <span className="text-subtle">{placeholder}</span>
              )
            }
          </BaseSelect.Value>
          <BaseSelect.Icon className="text-muted">
            <CaretDown size={16} weight="bold" aria-hidden="true" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            sideOffset={6}
            className="z-50 outline-none"
          >
            <BaseSelect.Popup
              className={cn(
                'max-h-72 w-[var(--select-anchor-width)] overflow-auto rounded-md border border-line bg-raised p-1 shadow-lg',
                'outline-none',
              )}
            >
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-sm text-ink',
                    'data-[selected]:bg-brand data-[selected]:text-brand-fg',
                    'data-[highlighted]:bg-surface',
                  )}
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator />
                </BaseSelect.Item>
              ))}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  )
}
