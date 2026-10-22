import { stepSelectionFocus } from '../../document-selection'
import type { KeyboardEvent } from 'react'
import type { InlineSlice } from '../../document-inline-changes'
import type { WrappedLine } from '../../document-page-flow'

/**
 * Whether a key press inserts text. A single-character key with no command
 * modifier is one; the Enter and Backspace families are handled above.
 */
export function printableKey(event: {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  // A single code point, not a single UTF-16 code unit: an astral character
  // such as an emoji is one printable key even though `length` is two.
  return [...event.key].length === 1
}

export function arrowKey(
  key: string,
): 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | null {
  return key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown'
    ? key
    : null
}

/** Native textareas cannot skip read-only display spans on horizontal arrows. */
export function moveInlineSelection(
  event: KeyboardEvent<HTMLTextAreaElement>,
  input: {
    projection?: InlineSlice
    text: string
    paragraphId: string
    lines: WrappedLine[]
    active?: boolean
    onSelect: (offset?: number) => void
    onTextSelection?: (
      from: number,
      to: number,
      direction: 'forward' | 'backward',
    ) => void
  },
): boolean {
  const { projection } = input
  if (
    !projection ||
    input.active ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  )
    return false
  const node = event.currentTarget
  const start = projection.toEditable(node.selectionStart)
  const end = projection.toEditable(node.selectionEnd)
  const backward = node.selectionDirection === 'backward'
  const focus = backward ? start : end
  const anchor = backward ? end : start
  const step = stepSelectionFocus({
    key: event.key,
    paragraphId: input.paragraphId,
    offset: focus,
    text: input.text,
    lines: input.lines,
    column: 0,
  })
  const at =
    !event.shiftKey && start !== end
      ? event.key === 'ArrowLeft'
        ? start
        : end
      : step?.offset
  if (at === undefined) return false
  event.preventDefault()
  const from = event.shiftKey ? Math.min(anchor, at) : at
  const to = event.shiftKey ? Math.max(anchor, at) : at
  const direction = event.shiftKey && at < anchor ? 'backward' : 'forward'
  node.setSelectionRange(
    projection.toDisplay(from),
    projection.toDisplay(to),
    direction,
  )
  if (event.shiftKey) input.onTextSelection?.(from, to, direction)
  else input.onSelect(at)
  return true
}
