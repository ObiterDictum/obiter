import { Button as BaseButton } from '@base-ui-components/react/button'
import type { ReactNode, Ref } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
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
  /** React 19 passes `ref` as a prop; declared so a caller can focus the button. */
  ref?: Ref<HTMLButtonElement>
  /** Polymorphic render (e.g. `render={<Link to="/x" />}`). See Base UI render prop. */
  render?: BaseButtonRender
  /** Whether the rendered element is a real `<button>`. Pass false for a link. */
  nativeButton?: boolean
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-describedby'?: string
  'data-testid'?: string
}

const variantClasses = {
  primary:
    'bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-pressed',
  secondary: 'bg-fill text-ink hover:bg-fill-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-ink',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
} satisfies Record<NonNullable<ButtonProps['variant']>, string>

const sizeClasses = {
  sm: 'h-control-compact px-2 text-item gap-1',
  md: 'h-control px-3 text-item gap-2',
  lg: 'h-control-large px-4 text-item gap-2',
} satisfies Record<NonNullable<ButtonProps['size']>, string>

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
  nativeButton = true,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      nativeButton={nativeButton}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md whitespace-nowrap select-none',
        'transition-[background-color,border-color,transform,box-shadow] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
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
