import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import { markBreaks, type InlineSpan } from '../../document-inline-changes'
import type { ChangeReview } from './use-change-review'

export const InlineChangeReview = createContext<{
  activeChangeId?: string
  /** The single revision in the tab order; arrows rove to the others. */
  tabChangeId?: string
  moveChange?: (fromId: string, direction: -1 | 1) => void
  selectChange: (id: string) => void
} | null>(null)

/** The canvas's view of the review panel: selecting a revision opens it there. */
export function inlineReviewOf(review: ChangeReview, openPanel: () => void) {
  return {
    activeChangeId: review.activeChangeId,
    tabChangeId: review.inlineTabChangeId,
    moveChange: review.goToAdjacentInline,
    selectChange: (id: string) => {
      const index = review.changes.findIndex((change) => change.id === id)
      if (index >= 0) review.goTo(index)
      openPanel()
    },
  }
}

const BREAK_LABELS = new Map([
  ['\u21df', 'Page break'],
  ['\u21e5', 'Column break'],
])

/** Tracked text with its break marks labelled for assistive technology. */
export function labelledBreaks(text: string) {
  return markBreaks(text)
    .split(/([\u21df\u21e5])/u)
    .map((part, index) => {
      const label = BREAK_LABELS.get(part)
      return label ? (
        <span key={index} role="img" aria-label={label}>
          {part}
        </span>
      ) : (
        part
      )
    })
}

/** Painted text without revision spans, in editable characters. */
export function editableRangeText(range: Range) {
  const fragment = range.cloneContents()
  for (const node of fragment.querySelectorAll(
    '[data-inline-change]:not([data-inline-editable])',
  ))
    node.remove()
  return fragment.textContent ?? ''
}

export function InlineChange({
  span: {
    change,
    deleted,
    author = 'Unknown author',
    hyperlinkTarget,
    pending,
    editable,
  },
  text,
  tabStop,
  children,
}: {
  span: InlineSpan
  text: string
  tabStop: boolean
  children?: ReactNode
}) {
  const context = useContext(InlineChangeReview)
  const review = pending ? null : context
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
  const content = children ?? labelledBreaks(text)
  return (
    <span
      ref={node}
      data-inline-change={change.id}
      data-inline-editable={editable || undefined}
      data-pending-revision={pending || undefined}
      data-change-kind={deleted ? 'delete' : 'insert'}
      aria-current={active ? 'true' : undefined}
      role={deleted ? 'deletion' : 'insertion'}
      tabIndex={
        review && tabStop
          ? review.tabChangeId === change.id
            ? 0
            : -1
          : undefined
      }
      aria-description={
        pending
          ? `Unsaved ${deleted ? 'deletion' : 'insertion'}`
          : `${deleted ? 'Deletion' : 'Insertion'} by ${author}`
      }
      title={
        pending
          ? 'Unsaved tracked change'
          : `${author}${change.date ? ` · ${change.date}` : ''}`
      }
      onClick={(event) => {
        if (pending) return
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
      className={`${pending ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'} relative z-10 rounded-[1px] focus-visible:outline-2 focus-visible:outline-[#345e90] ${deleted ? 'text-[#9a3c32]' : 'text-[#21613e]'} ${active ? 'bg-[#f9e0a2]' : ''}`}
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
