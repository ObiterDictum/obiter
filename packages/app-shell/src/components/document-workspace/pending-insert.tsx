import { useEffect, useRef } from 'react'
import { insertPlainText, type LocalInsert } from '../../document-edits'
import { textDiff } from '../../document-model-text'
import type { ParagraphWordEdit } from './model-paragraph'
import {
  clearVerticalColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import { revealTypingLine } from './paragraph-editor'

export function PendingInsert({
  insert,
  selected,
  verticalCaret,
  onSelect,
  onTextChange,
  onInsertParagraph,
  onDeleteParagraph,
  onJoinPrevious,
  onWordEdit,
  restoreCaret,
}: {
  insert: LocalInsert
  selected: boolean
  verticalCaret?: VerticalCaretColumn
  onSelect: () => void
  onTextChange?: (clientId: string, text: string) => void
  onInsertParagraph?: (afterParagraphId: string) => void
  onDeleteParagraph?: (paragraphId: string) => void
  onJoinPrevious?: (paragraphId: string) => boolean | void
  onWordEdit?: (edit: ParagraphWordEdit) => void
  restoreCaret?: { paragraphId: string; offset: number } | null
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  // A pending insert cannot continue a vertical-column run, so every way of
  // entering or editing it ends the run rather than holding a stale column.
  const clearColumn = () => clearVerticalColumn(verticalCaret)
  const text = insertPlainText(insert)
  const restore =
    restoreCaret?.paragraphId === insert.clientId
      ? restoreCaret.offset
      : undefined
  // Keep the caret after Enter (DOM selection).
  useEffect(() => {
    if (!selected) return
    const node = field.current
    if (!node) return
    node.focus({ preventScroll: true })
    if (restore != null) {
      const offset = Math.min(restore, node.value.length)
      node.setSelectionRange(offset, offset)
    }
    revealTypingLine(node)
  }, [selected, restore])

  return (
    <div
      data-paragraph-id={insert.clientId}
      aria-current={selected ? 'true' : undefined}
      aria-label="Pending paragraph"
      onClick={onSelect}
      className="relative min-h-[1.15em]"
    >
      <textarea
        ref={field}
        aria-label="Pending paragraph text"
        value={text}
        rows={1}
        onChange={(event) => {
          clearColumn()
          const next = event.target.value
          if (onWordEdit) {
            const diff = textDiff(text, next)
            onWordEdit({
              type: 'replace',
              paragraphId: insert.clientId,
              offset: diff.from,
              from: diff.from,
              to: diff.to,
              insert: diff.insert,
            })
            return
          }
          onTextChange?.(insert.clientId, next)
        }}
        onFocus={() => {
          clearColumn()
          onSelect()
        }}
        onCompositionStart={clearColumn}
        onCompositionEnd={clearColumn}
        onMouseDown={clearColumn}
        onKeyDown={(event) => {
          clearColumn()
          const start = event.currentTarget.selectionStart
          const end = event.currentTarget.selectionEnd
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (onWordEdit) {
              onWordEdit({
                type: 'split',
                paragraphId: insert.clientId,
                offset: start,
              })
              return
            }
            onInsertParagraph?.(insert.clientId)
            return
          }
          if (event.key === 'Backspace' && start === end) {
            if (onWordEdit) {
              event.preventDefault()
              onWordEdit({
                type: 'deleteBackward',
                paragraphId: insert.clientId,
                offset: start,
              })
              return
            }
            if (start === 0) {
              event.preventDefault()
              if (onJoinPrevious?.(insert.clientId)) return
              if (text.length === 0) {
                onDeleteParagraph?.(insert.clientId)
              }
            }
            return
          }
          if (
            event.key === 'Delete' &&
            start === end &&
            start === text.length
          ) {
            event.preventDefault()
            onWordEdit?.({
              type: 'deleteForward',
              paragraphId: insert.clientId,
              offset: start,
            })
          }
        }}
        onClick={(event) => {
          clearColumn()
          event.stopPropagation()
          onSelect()
        }}
        className="field-sizing-content caret-black block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit outline-none"
        style={{ lineHeight: '1.15', minHeight: '1.15em' }}
      />
    </div>
  )
}
