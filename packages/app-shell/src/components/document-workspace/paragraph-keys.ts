import { stepSelectionFocus } from '../../document-selection'
import type { KeyboardEvent } from 'react'
import type { InlineSlice } from '../../document-inline-changes'
import type { WrappedLine } from '../../document-page-flow'

export function printableKey(event: {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
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

const words = new Intl.Segmenter(undefined, { granularity: 'word' })

function modifiedOffset(
  text: string,
  lines: WrappedLine[],
  offset: number,
  right: boolean,
  alt: boolean,
  meta: boolean,
) {
  if (meta) {
    const line = lines.find((item) => offset >= item.from && offset <= item.to)
    return right ? (line?.to ?? text.length) : (line?.from ?? 0)
  }
  const parts = [...words.segment(text)].filter((part) => part.isWordLike)
  return right
    ? (parts
        .map((part) => (alt ? part.index + part.segment.length : part.index))
        .find((at) => at > offset) ?? text.length)
    : (parts
        .map((part) => part.index)
        .reverse()
        .find((at) => at < offset) ?? 0)
}

export function moveInlineSelection(
  event: KeyboardEvent<HTMLTextAreaElement>,
  input: {
    projection?: InlineSlice
    text: string
    paragraphId: string
    lines: WrappedLine[]
    selection?: { active: boolean }
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
    input.selection?.active ||
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
  const modified = event.ctrlKey || event.altKey || event.metaKey
  const at = modified
    ? modifiedOffset(
        input.text,
        input.lines,
        focus,
        event.key === 'ArrowRight',
        event.altKey,
        event.metaKey,
      )
    : !event.shiftKey && start !== end
      ? event.key === 'ArrowLeft'
        ? start
        : end
      : step?.offset
  if (at === undefined || (modified && at === focus && start === end))
    return false
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
