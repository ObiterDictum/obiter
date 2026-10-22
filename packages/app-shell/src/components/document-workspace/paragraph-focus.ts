import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import type { InlineSlice } from '../../document-inline-changes'
import { revealTypingLine } from './paragraph-reveal'

/** Synchronise the model's editable selection with the browser's display range. */
export function useParagraphFocus(input: {
  field: RefObject<HTMLTextAreaElement | null>
  written: RefObject<{ from: number; to: number } | null>
  selected: boolean
  restoreCaret?: number
  text: string
  projection?: InlineSlice
  from?: number
  to?: number
  direction?: 'forward' | 'backward' | 'none'
}) {
  const {
    field,
    written,
    selected,
    restoreCaret,
    text,
    projection,
    from,
    to,
    direction,
  } = input
  // Browser focus and native selection are external state; write before paint
  // so a save/model swap cannot flash the caret at a display-only revision.
  useLayoutEffect(() => {
    if (!selected) return
    const node = field.current
    if (!node) return
    const display = (at: number) => projection?.toDisplay(at) ?? at
    node.focus({ preventScroll: true })
    if (from != null && to != null) {
      const start = Math.min(from, text.length)
      const end = Math.min(to, text.length)
      node.setSelectionRange(
        display(start),
        display(end),
        direction === 'none' ? undefined : direction,
      )
      written.current = { from: start, to: end }
    } else if (restoreCaret != null) {
      const offset = Math.min(restoreCaret, text.length)
      node.setSelectionRange(display(offset), display(offset))
      written.current = { from: offset, to: offset }
    }
    revealTypingLine(node)
  }, [selected, restoreCaret, from, to, direction, projection?.text])
}
