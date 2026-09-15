import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@obiter/ui'
import {
  stepSelectionFocus,
  type SelectionEndpoint,
} from '../../document-selection'
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

/**
 * What the editor needs to take part in a document selection. `range` is the
 * selection's slice of this textarea, in this editor's local offsets; `active`
 * says a non-collapsed document selection exists, which is when the editor owns
 * Shift+Arrow and the edit keys instead of leaving them to the textarea.
 */
export type ParagraphSelectionBinding = {
  range: { from: number; to: number } | null
  /**
   * Slice-local offset of the moving end. The model owns it, so an extension
   * never has to guess from a DOM range whose direction a programmatic write
   * has already reset.
   */
  focus: number | null
  direction: 'forward' | 'backward' | 'none'
  active: boolean
  onExtend: (focus: SelectionEndpoint, anchor: SelectionEndpoint) => void
  onCollapse: (edge: 'start' | 'end' | 'focus') => void
  onSelectAll: () => void
  onReplaceRange: (text: string) => void
  onDeleteRange: () => void
  onSplitRange: () => void
  onCopyRange: (clipboard: DataTransfer | null) => void
  onCutRange: (clipboard: DataTransfer | null) => void
  onClear: () => void
}

export type ParagraphSelectionHandlers = Omit<
  ParagraphSelectionBinding,
  'range' | 'focus'
>
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
  selected: boolean
  restoreCaret?: number
  style?: CSSProperties
  className?: string
  lines: WrappedLine[]
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
  verticalCaret?: VerticalCaretColumn
  selection?: ParagraphSelectionBinding
  onSelect: () => void
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
  const field = useRef<HTMLTextAreaElement>(null)
  // IME composition owns key events until it ends; intercepting them loses text.
  const composing = useRef(false)
  // The DOM range this editor last wrote itself. A select event that still
  // reports that range is our own write arriving late, after the model may
  // already have moved on (Escape clearing the selection, say); mirroring it
  // back would resurrect a selection the user did not make. A user-made
  // selection always differs from the range we last wrote.
  const written = useRef<{ from: number; to: number } | null>(null)
  const clearColumn = () => clearVerticalColumn(verticalCaret)
  const selectionFrom = selection?.range?.from
  const selectionTo = selection?.range?.to
  const selectionDirection = selection?.direction
  const selectionFocus = selection?.focus
  // Browser selection and focus are the one external boundary here: the model
  // owns the selection and the DOM has to be told, so this stays an effect
  // rather than derived rendering. It also keeps the caret after Enter.
  useEffect(() => {
    if (!selected) return
    const node = field.current
    if (!node) return
    node.focus({ preventScroll: true })
    if (selectionFrom != null && selectionTo != null) {
      const from = Math.min(selectionFrom, node.value.length)
      const to = Math.min(selectionTo, node.value.length)
      node.setSelectionRange(
        from,
        to,
        selectionDirection === 'none' ? undefined : selectionDirection,
      )
      written.current = { from, to }
    } else if (restoreCaret != null) {
      const offset = Math.min(restoreCaret, node.value.length)
      node.setSelectionRange(offset, offset)
      written.current = { from: offset, to: offset }
    }
    revealTypingLine(node)
  }, [selected, restoreCaret, selectionFrom, selectionTo, selectionDirection])

  function focusEnd(node: HTMLTextAreaElement): {
    anchor: number
    focus: number
  } {
    // Where the moving end is depends on which way the last extension went;
    // the textarea tracks that in selectionDirection.
    const backward = node.selectionDirection === 'backward'
    return backward
      ? { anchor: node.selectionEnd, focus: node.selectionStart }
      : { anchor: node.selectionStart, focus: node.selectionEnd }
  }

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
        // A document selection is replaced by the model operation the
        // beforeinput handler planned; a change that arrives anyway must not be
        // applied to one paragraph of it.
        if (selection?.active) return
        onChangeText(event.target.value)
      }}
      onFocus={() => {
        // Only the paragraph a vertical move was destined for inherits the
        // run's column; any other focus starts a fresh editing session.
        if (!consumeVerticalDelivery(verticalCaret, paragraphId)) clearColumn()
        if (onFocusParagraph) onFocusParagraph()
        else onSelect()
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
        // A press collapses the document selection; the drag that follows is
        // mirrored from the textarea as it changes.
        selection?.onClear()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return
        const node = event.currentTarget
        const start = node.selectionStart
        const end = node.selectionEnd
        const verticalKey =
          event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? event.key
            : null
        // Every key that is not a plain vertical arrow ends the column run.
        // Shift/Ctrl/Alt/Meta arrows keep their own rules below.
        if (!verticalKey) clearColumn()
        if (event.key === 'Escape') {
          if (!selection?.active) return
          event.preventDefault()
          selection.onCollapse('focus')
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
          (event.key === 'Backspace' || event.key === 'Delete') &&
          selection?.active
        ) {
          event.preventDefault()
          selection.onDeleteRange()
          return
        }
        if (selection?.active && printableKey(event)) {
          // Typing over a document selection is a model replacement. It is
          // intercepted on the key press rather than on beforeinput because
          // React synthesises beforeinput from composition and textInput, so
          // it cannot be trusted to see every keystroke before the DOM changes.
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
        // Ctrl/Alt/Meta keep platform shortcuts such as word moves and
        // line/document jumps; a document selection does not change them.
        if (event.ctrlKey || event.altKey || event.metaKey) return
        const arrow = arrowKey(event.key)
        if (selection?.active && !event.shiftKey) {
          // A plain arrow collapses the document selection to the end it
          // points at, the way it collapses a native one.
          if (!arrow) return
          event.preventDefault()
          selection.onCollapse(
            arrow === 'ArrowLeft' || arrow === 'ArrowUp' ? 'start' : 'end',
          )
          return
        }
        if (!arrow) return
        // A model-owned selection carries its own focus; only a selection made
        // natively in the textarea has to be read out of the DOM.
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
          // With no document selection yet, the textarea extends natively
          // inside the paragraph; the run's column is still retained so a
          // later crossing lands on it. Once the model owns a selection, every
          // step goes through it so the DOM can never drift from the model.
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
          // A vertical press that cannot cross paragraphs ends the run rather
          // than holding a column for a move that never happened.
          if (verticalKey) clearColumn()
          return
        }
        if (!verticalKey && step.paragraphId === paragraphId) return
        event.preventDefault()
        if (step.paragraphId === paragraphId) {
          node.setSelectionRange(step.offset, step.offset)
          written.current = { from: step.offset, to: step.offset }
          revealTypingLine(node)
          return
        }
        if (verticalKey) armVerticalDelivery(verticalCaret, step)
        onMoveCaret(step.paragraphId, step.offset)
      }}
      onPaste={(event) => {
        if (!selection?.active) return
        event.preventDefault()
        selection.onReplaceRange(event.clipboardData.getData('text/plain'))
      }}
      onCopy={(event) => {
        if (!selection?.active) return
        event.preventDefault()
        selection.onCopyRange(event.clipboardData)
      }}
      onCut={(event) => {
        if (!selection?.active) return
        event.preventDefault()
        selection.onCutRange(event.clipboardData)
      }}
      onClick={(event) => {
        event.stopPropagation()
        clearColumn()
        onSelect()
      }}
      onSelect={(event) => {
        const from = event.currentTarget.selectionStart
        const to = event.currentTarget.selectionEnd
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
        // The run overlay paints the document selection; the textarea's own
        // ::selection is painted the same colour so the focused paragraph and
        // its neighbours read as one highlight.
        'selection:bg-[#b8d4f5]',
        style?.height == null && 'field-sizing-content',
        className,
      )}
      style={style}
    />
  )
}

/**
 * Whether a key press inserts text. A single-character key with no command
 * modifier is one; the Enter and Backspace families are handled above.
 */
function printableKey(event: {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  return event.key.length === 1
}

function arrowKey(
  key: string,
): 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | null {
  return key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown'
    ? key
    : null
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
