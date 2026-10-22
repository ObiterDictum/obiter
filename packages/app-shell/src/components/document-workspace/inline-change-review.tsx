import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type { DocumentChangeWire } from '@obiter/contracts'

export const InlineChangeReview = createContext<{
  activeChangeId?: string
  selectChange: (id: string) => void
} | null>(null)

export function InlineChange({
  change,
  text,
}: {
  change: DocumentChangeWire
  text: string
}) {
  const review = useContext(InlineChangeReview)
  const node = useRef<HTMLSpanElement>(null)
  const active = review?.activeChangeId === change.id
  // Review navigation is a browser scroll boundary, independent of edit offsets.
  useLayoutEffect(() => {
    if (active)
      node.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const deleted =
    change.kind === 'delete' ||
    (change.kind === 'move' && change.direction === 'from')
  return (
    <span
      ref={node}
      data-inline-change={change.id}
      data-change-kind={deleted ? 'delete' : 'insert'}
      aria-current={review?.activeChangeId === change.id ? 'true' : undefined}
      role={review ? 'button' : undefined}
      tabIndex={review ? 0 : undefined}
      aria-label={`${deleted ? 'Deletion' : 'Insertion'} by ${change.author ?? 'Unknown author'}: ${text}`}
      title={`${change.author ?? 'Unknown author'}${change.date ? ` · ${change.date}` : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        review?.selectChange(change.id)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        review?.selectChange(change.id)
      }}
      className={`pointer-events-auto relative z-10 cursor-pointer rounded-[1px] focus-visible:outline-2 focus-visible:outline-[#345e90] ${deleted ? 'text-[#9a3c32]' : 'text-[#21613e]'} ${active ? 'bg-[#f9e0a2]' : ''}`}
      style={{
        textDecoration: deleted ? 'line-through' : 'underline',
        userSelect: 'none',
      }}
    >
      {text}
    </span>
  )
}
