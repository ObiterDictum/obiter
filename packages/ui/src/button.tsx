import { Button as BaseButton } from '@base-ui-components/react/button'
import type { ReactNode, Ref } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { cn } from './lib/cn'

type BaseButtonRender = React.ComponentProps<typeof BaseButton>['render']

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  children?: ReactNode
  className?: string
  ref?: Ref<HTMLButtonElement>
  render?: BaseButtonRender
  nativeButton?: boolean
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-describedby'?: string
  title?: string
  'data-testid'?: string
}

const baseClasses =
  'inline-flex items-center justify-center rounded-md whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,transform,box-shadow] duration-150 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const stateClasses = {
  idle: 'disabled:cursor-not-allowed disabled:opacity-45',
  loading: 'cursor-progress',
} satisfies Record<'idle' | 'loading', string>

const variantClasses = {
  primary:
    'bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-pressed',
  secondary: 'bg-fill text-ink hover:bg-fill-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-ink',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
} satisfies Record<ButtonVariant, string>

const sizeClasses = {
  sm: 'h-control-compact px-2 text-item gap-1',
  md: 'h-control px-3 text-item gap-2',
  lg: 'h-control-large px-4 text-item gap-2',
} satisfies Record<ButtonSize, string>

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  className?: string
} = {}) {
  return cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    loading ? stateClasses.loading : stateClasses.idle,
    className,
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconStart,
  iconEnd,
  className,
  disabled,
  render,
  nativeButton = true,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      nativeButton={nativeButton}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, loading, className })}
      render={render}
      {...props}
    >
      {loading ? (
        <CircleNotch size={16} className="animate-spin" aria-hidden="true" />
      ) : (
        iconStart
      )}
      {children}
      {iconEnd}
    </BaseButton>
  )
}
