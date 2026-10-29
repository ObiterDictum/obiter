import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cn } from './lib/cn'

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'children'
> {
  label?: ReactNode
  helperText?: ReactNode
  error?: ReactNode
  invalid?: boolean
  trailing?: ReactNode
  ref?: Ref<HTMLInputElement>
}

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
    <div className="flex flex-col gap-2">
      {label ? (
        <label htmlFor={inputId} className="text-meta text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        <input
          id={inputId}
          aria-invalid={showError || undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-control w-full rounded-md border bg-raised px-3 text-meta text-ink',
            'placeholder:text-subtle',
            'transition-[border-color,box-shadow] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:cursor-not-allowed disabled:opacity-45',
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
            'text-caption',
            showError ? 'text-danger' : 'text-muted',
          )}
        >
          {showError ? error : helperText}
        </p>
      ) : null}
    </div>
  )
}
