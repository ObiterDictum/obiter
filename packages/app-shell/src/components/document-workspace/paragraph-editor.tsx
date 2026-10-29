import { useParagraphFocus } from './paragraph-focus'
import { arrowKey, printableKey, moveInlineSelection } from './paragraph-keys'
import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@obiter/ui'
import { stepSelectionFocus } from '../../document-selection'
import { textDiff } from '../../document-model-text'
import {
  copyEditableSelection,
  cutEditableSelection,
} from './paragraph-clipboard'
import type { InlineSlice } from '../../document-inline-changes'
import {
  armVerticalDelivery,
  clearVerticalColumn,
  consumeVerticalDelivery,
  retainVerticalColumn,
  visualColumn,
  type ArrowNeighbor,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import type { WrappedLine } from '../../document-page-flow'
import type {
  ParagraphSelectionBinding,
  ParagraphSelectionHandlers,
} from './paragraph-selection-binding'
import { revealTypingLine } from './paragraph-reveal'

export { revealTypingLine } from './paragraph-reveal'

export type { ParagraphSelectionBinding, ParagraphSelectionHandlers }
export function ParagraphEditor({
  paragraphId,
  text,
  projection,
  trackedDescription,
  selected,
  restoreCaret,
  style,
  className,
  lines,
  previous,
  next,
  verticalCaret,
  selection,
  onSelect,
  onFocusParagraph,
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
  trackedDescription?: string
  projection?: InlineSlice
  selected: boolean
  restoreCaret?: number
  style?: CSSProperties
  className?: string
  lines: WrappedLine[]
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
  verticalCaret?: VerticalCaretColumn
  selection?: ParagraphSelectionBinding
  onSelect: (offset?: number) => void
  onFocusParagraph?: () => void
  onMoveCaret?: (paragraphId: string, offset: number) => void
  onTextSelection?: (
    start: number,
    end: number,
    direction: 'forward' | 'backward',
  ) => void
  onChangeText: (next: string) => void
  onBackspace: (offset: number) => void
  onDelete: (offset: number) => void
  onEnter: (offset: number) => void
  onLineBreak: (offset: number) => void
}) {
  const editable = (at: number) => projection?.toEditable(at) ?? at
  const display = (at: number) => projection?.toDisplay(at) ?? at
  const inputText = (value: string) => projection?.edit(value) ?? value
  const field = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const written = useRef<{ from: number; to: number } | null>(null)
  const clearColumn = () => clearVerticalColumn(verticalCaret)
  const selectionFrom = selection?.range?.from
  const selectionTo = selection?.range?.to
  const selectionDirection = selection?.direction
  const selectionFocus = selection?.focus
  useParagraphFocus({
    field,
    written,
    selected,
    restoreCaret,
    text,
    projection,
    from: selectionFrom,
    to: selectionTo,
    direction: selectionDirection,
  })

  function applyPayload(node: HTMLTextAreaElement, data: string): boolean {
    const from = editable(node.selectionStart)
    const to = editable(node.selectionEnd)
    if (selection?.active) {
      if (data.length > 0) selection.onPasteText?.(data, from, to)
      else selection.onRejectInput()
      return true
    }
    if (!selection?.onPasteText || data.length === 0) return false
    selection.onPasteText(data, from, to)
    return true
  }

  function focusEnd(node: HTMLTextAreaElement): {
    anchor: number
    focus: number
  } {
    const backward = node.selectionDirection === 'backward'
    return backward
      ? {
          anchor: editable(node.selectionEnd),
          focus: editable(node.selectionStart),
        }
      : {
          anchor: editable(node.selectionStart),
          focus: editable(node.selectionEnd),
        }
  }

  function applyDomInput(next: string) {
    if (!selection?.active) return
    const diff = textDiff(text, next)
    if (diff.insert.length === 0) {
      selection.onRejectInput()
      return
    }
    selection.onReplaceRange(diff.insert)
  }

  return (
    <textarea
      ref={field}
      aria-label="Paragraph text"
      aria-description={trackedDescription}
      value={projection?.text ?? text}
      rows={1}
      onChange={(event) => {
        clearColumn()
        if (composing.current) return
        if (selection?.active) {
          applyDomInput(inputText(event.target.value))
          return
        }
        onChangeText(inputText(event.target.value))
      }}
      onBeforeInput={(event) => {
        if (!selection?.active) return
        // SAFETY: onBeforeInput fires only for DOM beforeinput events whose nativeEvent is an InputEvent; inputType and data fall back to empty when absent, so a non-conforming event returns early below.
        const input = event.nativeEvent as InputEvent
        const inputType = input.inputType ?? ''
        if (inputType === 'insertCompositionText') return
        if (!inputType.startsWith('insert')) return
        event.preventDefault()
        const data =
          input.data ?? input.dataTransfer?.getData('text/plain') ?? ''
        if (data.length > 0) selection.onReplaceRange(data)
        else selection.onRejectInput()
      }}
      onFocus={() => {
        if (!consumeVerticalDelivery(verticalCaret, paragraphId)) clearColumn()
        if (onFocusParagraph) onFocusParagraph()
        else onSelect()
      }}
      onCompositionStart={() => {
        composing.current = true
        clearColumn()
      }}
      onCompositionEnd={(event) => {
        composing.current = false
        clearColumn()
        if (selection?.active)
          applyDomInput(inputText(event.currentTarget.value))
      }}
      onDrop={(event) => {
        const data = event.dataTransfer?.getData('text/plain') ?? ''
        if (!applyPayload(event.currentTarget, data)) return
        event.preventDefault()
      }}
      onDragOver={(event) => {
        if (selection?.active || selection?.onPasteText) event.preventDefault()
      }}
      onMouseDown={() => {
        clearColumn()
        selection?.onClear()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return
        const node = event.currentTarget
        const start = editable(node.selectionStart)
        const end = editable(node.selectionEnd)
        const arrow = arrowKey(event.key)
        const lineJump = event.key === 'Home' || event.key === 'End'
        const verticalKey =
          event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? event.key
            : null
        if (!verticalKey) clearColumn()
        if (
          moveInlineSelection(event, {
            projection,
            text,
            paragraphId,
            lines,
            selection,
            onSelect,
            onTextSelection,
          })
        )
          return
        if (event.key === 'Escape') {
          if (selection?.active) {
            event.preventDefault()
            selection.onCollapse('focus')
            return
          }
          if (selection?.onEscapeBlur) {
            event.preventDefault()
            selection.onEscapeBlur()
          }
          return
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          event.key.toLowerCase() === 'a'
        ) {
          if (!selection) return
          event.preventDefault()
          selection.onSelectAll()
          return
        }
        if (
          selection?.active &&
          (arrow != null || lineJump) &&
          (event.ctrlKey || event.altKey || event.metaKey || lineJump)
        ) {
          event.preventDefault()
          selection.onCollapse(
            event.key === 'ArrowLeft' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home'
              ? 'start'
              : 'end',
          )
          return
        }
        if (
          (event.key === 'Backspace' || event.key === 'Delete') &&
          selection?.active
        ) {
          event.preventDefault()
          selection.onDeleteRange()
          return
        }
        if (selection?.active && printableKey(event)) {
          event.preventDefault()
          selection.onReplaceRange(event.key)
          return
        }
        if (event.key === 'Enter' && selection?.active) {
          if (event.ctrlKey || event.altKey || event.metaKey) return
          event.preventDefault()
          if (event.shiftKey) selection.onReplaceRange('\n')
          else selection.onSplitRange()
          return
        }
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
        if (event.ctrlKey || event.altKey || event.metaKey) return
        if (selection?.active && !event.shiftKey) {
          if (!arrow) return
          event.preventDefault()
          selection.onCollapse(
            arrow === 'ArrowLeft' || arrow === 'ArrowUp' ? 'start' : 'end',
          )
          return
        }
        if (!arrow) return
        const moving =
          selection?.active && selectionFocus != null
            ? { anchor: selectionFocus, focus: selectionFocus }
            : focusEnd(node)
        const column = verticalKey
          ? retainVerticalColumn(verticalCaret, lines, moving.focus)
          : visualColumn(lines, moving.focus)
        if (event.shiftKey) {
          if (!selection) return
          const step = stepSelectionFocus({
            key: arrow,
            paragraphId,
            offset: moving.focus,
            text,
            lines,
            column,
            previous,
            next,
          })
          if (!step) {
            if (verticalKey) clearColumn()
            return
          }
          if (step.paragraphId === paragraphId && !selection.active) return
          event.preventDefault()
          if (verticalKey) {
            armVerticalDelivery(verticalCaret, {
              paragraphId: step.paragraphId,
              offset: step.offset,
            })
          }
          selection.onExtend(step, { paragraphId, offset: moving.anchor })
          return
        }
        if (start !== end || !onMoveCaret) {
          if (verticalKey) clearColumn()
          return
        }
        const step = stepSelectionFocus({
          key: arrow,
          paragraphId,
          offset: start,
          text,
          lines,
          column,
          previous,
          next,
        })
        if (!step) {
          if (verticalKey) clearColumn()
          return
        }
        if (!verticalKey && step.paragraphId === paragraphId) return
        event.preventDefault()
        if (step.paragraphId === paragraphId) {
          node.setSelectionRange(display(step.offset), display(step.offset))
          written.current = { from: step.offset, to: step.offset }
          revealTypingLine(node)
          return
        }
        if (verticalKey) armVerticalDelivery(verticalCaret, step)
        onMoveCaret(step.paragraphId, step.offset)
      }}
      onPaste={(event) => {
        const data = event.clipboardData?.getData('text/plain') ?? ''
        if (!applyPayload(event.currentTarget, data)) return
        event.preventDefault()
      }}
      onCopy={(event) => {
        if (projection && !selection?.active) {
          copyEditableSelection(event, text, projection)
          return
        }
        if (!selection?.active) return
        event.preventDefault()
        selection.onCopyRange(event.clipboardData)
      }}
      onCut={(event) => {
        if (projection && !selection?.active) {
          onChangeText(cutEditableSelection(event, text, projection))
          return
        }
        if (!selection?.active) return
        event.preventDefault()
        selection.onCutRange(event.clipboardData)
      }}
      onClick={(event) => {
        event.stopPropagation()
        clearColumn()
        onSelect(editable(event.currentTarget.selectionStart))
      }}
      onSelect={(event) => {
        const from = editable(event.currentTarget.selectionStart)
        const to = editable(event.currentTarget.selectionEnd)
        const last = written.current
        if (last && last.from === from && last.to === to) return
        onTextSelection?.(
          from,
          to,
          event.currentTarget.selectionDirection === 'backward'
            ? 'backward'
            : 'forward',
        )
      }}
      className={cn(
        'block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit',
        'caret-black border-0 outline-none focus-visible:ring-0',
        'selection:bg-[#b8d4f5]',
        style?.height == null && 'field-sizing-content',
        className,
      )}
      style={style}
    />
  )
}
