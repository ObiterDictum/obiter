import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type { DocumentChangeWire } from '@obiter/contracts'
import { BREAK_MARKS } from '../../document-inline-changes'

export const InlineChangeReview = createContext<{
  activeChangeId?: string
  /** The single revision in the tab order; arrows rove to the others. */
  tabChangeId?: string
  moveChange?: (fromId: string, direction: -1 | 1) => void
  selectChange: (id: string) => void
} | null>(null)

export function InlineChange({
  change,
  text,
  deleted = change.kind === 'delete' ||
    (change.kind === 'move' && change.direction === 'from'),
  author = change.author,
  hyperlinkTarget,
  tabStop = true,
}: {
  change: DocumentChangeWire
  text: string
  deleted?: boolean
  author?: string
  hyperlinkTarget?: string
  tabStop?: boolean
}) {
  const review = useContext(InlineChangeReview)
  const node = useRef<HTMLSpanElement>(null)
  const active = review?.activeChangeId === change.id
  // Review navigation is a browser scroll boundary, independent of edit offsets.
  useLayoutEffect(() => {
    if (active && tabStop) {
      node.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      if (document.activeElement?.hasAttribute('data-inline-change'))
        node.current?.focus({ preventScroll: true })
    }
  }, [active, tabStop])
  const content = text.split(/([\u21df\u21e5])/u).map((part, index) =>
    part === BREAK_MARKS['\f'] || part === BREAK_MARKS['\v'] ? (
      <span
        key={index}
        role="img"
        aria-label={part === BREAK_MARKS['\f'] ? 'Page break' : 'Column break'}
      >
        {part}
      </span>
    ) : (
      part
    ),
  )
  return (
    <span
      ref={node}
      data-inline-change={change.id}
      data-change-kind={deleted ? 'delete' : 'insert'}
      aria-current={review?.activeChangeId === change.id ? 'true' : undefined}
      role={deleted ? 'deletion' : 'insertion'}
      tabIndex={
        review && tabStop
          ? review.tabChangeId === change.id
            ? 0
            : -1
          : undefined
      }
      aria-description={`${deleted ? 'Deletion' : 'Insertion'} by ${author ?? 'Unknown author'}: ${text}`}
      title={`${author ?? 'Unknown author'}${change.date ? ` · ${change.date}` : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        review?.selectChange(change.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          review?.moveChange?.(change.id, event.key === 'ArrowLeft' ? -1 : 1)
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        review?.selectChange(change.id)
      }}
      className={`pointer-events-auto relative z-10 cursor-pointer rounded-[1px] focus-visible:outline-2 focus-visible:outline-[#345e90] ${deleted ? 'text-[#9a3c32]' : 'text-[#21613e]'} ${active ? 'bg-[#f9e0a2]' : ''}`}
      style={{
        textDecoration: deleted ? 'line-through' : 'underline',
      }}
    >
      {hyperlinkTarget ? (
        // Word keeps the revision colour on tracked link text; a dotted rule
        // marks the link without hiding the insertion underline or strike.
        <span
          data-hyperlink-target={hyperlinkTarget}
          className="border-b border-dotted border-current"
          title={hyperlinkTarget}
        >
          {content}
        </span>
      ) : (
        content
      )}
    </span>
  )
}
