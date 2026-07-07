import { Button as BaseButton } from '@base-ui-components/react/button'
import type { ReactNode } from 'react'
import { cn } from './lib/cn'

type BaseButtonRender = React.ComponentProps<typeof BaseButton>['render']

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  children?: ReactNode
  className?: string
  /** Polymorphic render (e.g. `render={<Link to="/x" />}`). See Base UI render prop. */
  render?: BaseButtonRender
  'aria-label'?: string
  'data-testid'?: string
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-pressed shadow-sm',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-raised',
  ghost: 'bg-transparent text-ink hover:bg-surface',
  danger: 'bg-danger text-danger-fg hover:brightness-95 shadow-sm',
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
}

/**
 * Button — the single interactive element style. Calm, tactile, keyboard-first.
 * Built on Base UI Button (focus management + render prop).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconStart,
  iconEnd,
  className,
  disabled,
  render,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      nativeButton
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,transform,box-shadow] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'active:translate-y-px',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      render={render}
      {...props}
    >
      {loading ? <Spinner /> : iconStart}
      {children}
      {iconEnd}
    </BaseButton>
  )
}

function Spinner() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
