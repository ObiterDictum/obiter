import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './lib/cn'

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'children'
> {
  label?: ReactNode
  helperText?: ReactNode
  error?: ReactNode
  invalid?: boolean
  /** Right-aligned affordance slot (e.g. a show/hide toggle). */
  trailing?: ReactNode
}

/**
 * Input — a labeled text field. Label above, helper/error below (form rule).
 * Uses a native input; accessibility comes from label association, aria-invalid,
 * and aria-describedby wiring.
 */
export function Input({
  label,
  helperText,
  error,
  invalid,
  trailing,
  id,
  className,
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedById = `${inputId}-describe`
  const showError = invalid || Boolean(error)
  const describedBy = showError || helperText ? describedById : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        <input
          id={inputId}
          aria-invalid={showError || undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-10 w-full rounded-md border bg-surface px-3 text-sm text-ink',
            'placeholder:text-subtle',
            'transition-[border-color,box-shadow] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            'disabled:cursor-not-allowed disabled:opacity-60',
            showError
              ? 'border-danger'
              : 'border-line hover:border-line-strong',
            trailing ? 'pr-10' : '',
            className,
          )}
          {...props}
        />
        {trailing ? (
          <div className="pointer-events-none absolute right-2 flex items-center text-muted">
            {trailing}
          </div>
        ) : null}
      </div>
      {showError || helperText ? (
        <p
          id={describedById}
          className={cn(
            'text-xs leading-4',
            showError ? 'text-danger' : 'text-muted',
          )}
        >
          {showError ? error : helperText}
        </p>
      ) : null}
    </div>
  )
}
