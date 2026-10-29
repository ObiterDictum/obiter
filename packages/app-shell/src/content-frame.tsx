import { cn } from '@obiter/ui'
import type { ReactNode } from 'react'

export function ContentFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[1216px] px-12 max-compact:px-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
