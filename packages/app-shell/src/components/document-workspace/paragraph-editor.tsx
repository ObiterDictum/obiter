import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@obiter/ui'

export function ParagraphEditor({
  text,
  selected,
  restoreCaret,
  style,
  className,
  onSelect,
  onChangeText,
  onBackspace,
  onDelete,
  onEnter,
  onLineBreak,
}: {
  text: string
  selected: boolean
  restoreCaret?: number
  style?: CSSProperties
  className?: string
  onSelect: () => void
  onChangeText: (next: string) => void
  onBackspace: (offset: number) => void
  onDelete: (offset: number) => void
  onEnter: (offset: number) => void
  onLineBreak: (offset: number) => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  // Keep the caret after Enter (DOM selection).
  useEffect(() => {
    if (!selected) return
    const node = field.current
    if (!node) return
    node.focus({ preventScroll: true })
    if (restoreCaret != null) {
      const offset = Math.min(restoreCaret, node.value.length)
      node.setSelectionRange(offset, offset)
    }
    revealTypingLine(node)
  }, [selected, restoreCaret])

  return (
    <textarea
      ref={field}
      aria-label="Paragraph text"
      value={text}
      rows={1}
      spellCheck={false}
      onChange={(event) => onChangeText(event.target.value)}
      onFocus={onSelect}
      onKeyDown={(event) => {
        const start = event.currentTarget.selectionStart
        const end = event.currentTarget.selectionEnd
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          onLineBreak(start)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          onEnter(start)
          return
        }
        if (event.key === 'Backspace' && start === end) {
          event.preventDefault()
          onBackspace(start)
          return
        }
        if (event.key === 'Delete' && start === end) {
          event.preventDefault()
          onDelete(start)
        }
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className={cn(
        'block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit',
        'border-0 outline-none focus-visible:ring-0',
        style?.height == null && 'field-sizing-content',
        className,
      )}
      style={{ caretColor: '#111', ...style }}
    />
  )
}

export function revealTypingLine(node: HTMLElement) {
  const desk = node.closest('[data-document-desk]')
  if (!(desk instanceof HTMLElement)) return
  const deskBox = desk.getBoundingClientRect()
  const box = node.getBoundingClientRect()
  if (box.height <= 0) return
  if (box.top >= deskBox.top && box.bottom <= deskBox.bottom) return
  if (box.top < deskBox.top) {
    desk.scrollTop += box.top - deskBox.top - 8
    return
  }
  desk.scrollTop += box.bottom - deskBox.bottom + 8
}
