import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@obiter/ui'
import {
  armVerticalDelivery,
  clearVerticalColumn,
  consumeVerticalDelivery,
  offsetAfterArrow,
  offsetVertically,
  retainVerticalColumn,
  visualColumn,
  type ArrowNeighbor,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import type { WrappedLine } from '../../document-page-flow'

export function ParagraphEditor({
  paragraphId,
  text,
  selected,
  restoreCaret,
  style,
  className,
  lines,
  previous,
  next,
  verticalCaret,
  onSelect,
  onMoveCaret,
  onTextSelection,
  onChangeText,
  onBackspace,
  onDelete,
  onEnter,
  onLineBreak,
}: {
  paragraphId: string
  text: string
  selected: boolean
  restoreCaret?: number
  style?: CSSProperties
  className?: string
  lines: WrappedLine[]
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
  verticalCaret?: VerticalCaretColumn
  onSelect: () => void
  onMoveCaret?: (paragraphId: string, offset: number) => void
  onTextSelection?: (start: number, end: number) => void
  onChangeText: (next: string) => void
  onBackspace: (offset: number) => void
  onDelete: (offset: number) => void
  onEnter: (offset: number) => void
  onLineBreak: (offset: number) => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  // IME composition owns key events until it ends; intercepting them loses text.
  const composing = useRef(false)
  const clearColumn = () => clearVerticalColumn(verticalCaret)
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
      onChange={(event) => {
        // Any text input, including a paste or an IME commit, ends the run.
        clearColumn()
        onChangeText(event.target.value)
      }}
      onFocus={() => {
        // Only the paragraph a vertical move was destined for inherits the
        // run's column; any other focus starts a fresh editing session.
        if (!consumeVerticalDelivery(verticalCaret, paragraphId)) clearColumn()
        onSelect()
      }}
      onCompositionStart={() => {
        composing.current = true
        clearColumn()
      }}
      onCompositionEnd={() => {
        composing.current = false
        clearColumn()
      }}
      onMouseDown={() => {
        clearColumn()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return
        const start = event.currentTarget.selectionStart
        const end = event.currentTarget.selectionEnd
        const verticalKey =
          event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? event.key
            : null
        // Every key that is not a plain vertical arrow ends the column run.
        // Shift/Ctrl/Alt/Meta arrows stay native and leave it untouched.
        if (!verticalKey) clearColumn()
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
          return
        }
        // Only plain arrows cross paragraphs. Shift keeps native selection
        // (E52 owns cross-paragraph selection); Ctrl/Alt/Meta keep platform
        // shortcuts such as word moves and line/document jumps.
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
          return
        }
        if (start !== end || !onMoveCaret) {
          if (verticalKey) clearColumn()
          return
        }
        if (verticalKey) {
          const column = retainVerticalColumn(verticalCaret, lines, start)
          // Own movement between wrapped lines too: native movement would
          // start from the clamped caret and lose the retained column.
          if (verticalCaret) {
            const within = offsetVertically({
              key: verticalKey,
              offset: start,
              lines,
              column,
            })
            if (within != null) {
              event.preventDefault()
              event.currentTarget.setSelectionRange(within, within)
              revealTypingLine(event.currentTarget)
              return
            }
          }
          const move = offsetAfterArrow({
            key: verticalKey,
            offset: start,
            text,
            lines,
            column,
            previous,
            next,
          })
          if (!move) {
            // A vertical press that cannot cross paragraphs ends the run
            // rather than holding a column for a move that never happened.
            clearColumn()
            return
          }
          event.preventDefault()
          if (verticalCaret) armVerticalDelivery(verticalCaret, move)
          onMoveCaret(move.paragraphId, move.offset)
          return
        }
        const move = offsetAfterArrow({
          key: event.key,
          offset: start,
          text,
          lines,
          column: visualColumn(lines, start),
          previous,
          next,
        })
        if (!move) return
        event.preventDefault()
        onMoveCaret(move.paragraphId, move.offset)
      }}
      onClick={(event) => {
        event.stopPropagation()
        clearColumn()
        onSelect()
      }}
      onSelect={(event) => {
        onTextSelection?.(
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        )
      }}
      className={cn(
        'block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit',
        'caret-black border-0 outline-none focus-visible:ring-0',
        style?.height == null && 'field-sizing-content',
        className,
      )}
      style={style}
    />
  )
}

export function revealTypingLine(node: HTMLElement) {
  const page = node.closest('[data-document-page]')
  if (page instanceof HTMLElement) {
    page.scrollTop = 0
    for (const slot of page.querySelectorAll('[aria-label="Document body"]')) {
      if (slot instanceof HTMLElement) slot.scrollTop = 0
    }
  }
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
