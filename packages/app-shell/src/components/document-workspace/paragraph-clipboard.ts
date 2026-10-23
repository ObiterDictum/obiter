import type { ClipboardEvent } from 'react'
import type { InlineSlice } from '../../document-inline-changes'

export function copyEditableSelection(
  event: ClipboardEvent<HTMLTextAreaElement>,
  text: string,
  projection: InlineSlice,
) {
  event.preventDefault()
  const from = projection.toEditable(event.currentTarget.selectionStart)
  const to = projection.toEditable(event.currentTarget.selectionEnd)
  event.clipboardData.setData('text/plain', text.slice(from, to))
  return { from, to }
}

export function cutEditableSelection(
  event: ClipboardEvent<HTMLTextAreaElement>,
  text: string,
  projection: InlineSlice,
) {
  const { from, to } = copyEditableSelection(event, text, projection)
  return text.slice(0, from) + text.slice(to)
}
