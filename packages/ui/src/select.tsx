import { Select as BaseSelect } from '@base-ui-components/react/select'
import { useId, type ReactNode } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cn } from './lib/cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  options: SelectOption[]
  ariaLabel?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string | null) => void
  placeholder?: string
  label?: ReactNode
  invalid?: boolean
  name?: string
  disabled?: boolean
  size?: 'default' | 'compact'
  className?: string
}

function optionLabel(options: SelectOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

export function Select({
  options,
  ariaLabel,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select…',
  label,
  invalid,
  name,
  disabled,
  size = 'default',
  className,
}: SelectProps) {
  const labelId = useId()
  const compact = size === 'compact'
  return (
    <div className={cn('flex flex-col gap-2', compact && 'gap-0', className)}>
      {label ? (
        <span id={labelId} className="text-meta text-ink">
          {label}
        </span>
      ) : null}
      <BaseSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        onValueChange={(next) => onValueChange?.(next ?? null)}
        items={options}
      >
        <BaseSelect.Trigger
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : (ariaLabel ?? placeholder)}
          aria-invalid={invalid || undefined}
          className={cn(
            compact
              ? 'inline-flex h-7 items-center justify-between gap-1 rounded-sm px-1.5 text-caption text-muted pointer-coarse:h-11'
              : 'inline-flex h-control w-full items-center justify-between gap-2 rounded-md border bg-raised px-3 text-meta text-ink',
            compact
              ? 'bg-fill hover:bg-fill-hover data-[popup-open]:bg-fill-hover'
              : 'transition-[border-color,box-shadow] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:cursor-not-allowed disabled:opacity-45',
            compact ? undefined : 'data-[popup-open]:border-brand',
            compact
              ? undefined
              : invalid
                ? 'border-danger'
                : 'border-line hover:border-line-strong',
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
            <CaretDown
              size={compact ? 12 : 16}
              weight="regular"
              aria-hidden="true"
            />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={8} className="z-50 outline-none">
            <BaseSelect.Popup
              className={cn(
                'max-h-72 w-[var(--select-anchor-width)] overflow-auto rounded-lg border border-line bg-raised p-2 shadow-lg',
                'outline-none',
              )}
            >
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded-sm px-3 py-1.5 text-meta text-ink',
                    'data-[selected]:bg-brand-soft data-[selected]:text-ink',
                    'data-[highlighted]:bg-hover',
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
