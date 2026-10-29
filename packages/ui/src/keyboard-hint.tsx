import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn'

export function KeyboardHint({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-fill px-1 font-sans text-caption text-subtle in-disabled:hidden',
        className,
      )}
      {...props}
    />
  )
}
