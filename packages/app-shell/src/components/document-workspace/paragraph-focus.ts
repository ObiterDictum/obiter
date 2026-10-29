import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import type { InlineSlice } from '../../document-inline-changes'
import { revealTypingLine } from './paragraph-reveal'

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
  useLayoutEffect(() => {
    if (!selected) return
    const node = field.current
    if (!node) return
    const display = (at: number) => projection?.toDisplay(at) ?? at
    node.focus({ preventScroll: true })
    const differs = (from: number, to: number) =>
      (projection?.toEditable(node.selectionStart) ?? node.selectionStart) !==
        from ||
      (projection?.toEditable(node.selectionEnd) ?? node.selectionEnd) !== to
    if (from != null && to != null) {
      const start = Math.min(from, text.length)
      const end = Math.min(to, text.length)
      if (differs(start, end))
        node.setSelectionRange(
          display(start),
          display(end),
          direction === 'none' ? undefined : direction,
        )
      written.current = { from: start, to: end }
    } else if (restoreCaret != null) {
      const offset = Math.min(restoreCaret, text.length)
      if (differs(offset, offset))
        node.setSelectionRange(display(offset), display(offset))
      written.current = { from: offset, to: offset }
    }
    revealTypingLine(node)
  }, [selected, restoreCaret, from, to, direction, projection?.text])
}
