import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@obiter/ui'
import { stepSelectionFocus } from '../../document-selection'
import { textDiff } from '../../document-model-text'
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

export type { ParagraphSelectionBinding, ParagraphSelectionHandlers }
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

  /**
   * Apply a DOM value the key handler did not intercept - a paste, a drop, an
   * IME commit, any beforeinput-only edit - as a replacement of the document
   * selection. The insertion the DOM gained becomes the text that replaces the
   * whole range, so a cross-paragraph selection is replaced coherently rather
   * than silently reverted. A change that only removed text cannot be expressed
   * that way and is refused with a notice.
   */
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
      value={text}
      rows={1}
      spellCheck={false}
      onChange={(event) => {
        // Any text input, including a paste or an IME commit, ends the run.
        clearColumn()
        // A composition's own changes are not the commit; the commit arrives
        // at compositionEnd and is applied once from there.
        if (composing.current) return
        // With a document selection the change is a replacement of the whole
        // range, not an edit of one paragraph of it.
        if (selection?.active) {
          applyDomInput(event.target.value)
          return
        }
        onChangeText(event.target.value)
      }}
      onBeforeInput={(event) => {
        if (!selection?.active) return
        const input = event.nativeEvent as InputEvent
        const inputType = input.inputType ?? ''
        // The composition's own text is not the commit and must not be
        // intercepted while the IME still owns the field.
        if (inputType === 'insertCompositionText') return
        if (!inputType.startsWith('insert')) return
        // A paste, drop or replacement that reached the input layer rather
        // than a key event still replaces the document selection. Formatted
        // paste carries its text on the data transfer rather than data.
        event.preventDefault()
        const data =
          input.data ?? input.dataTransfer?.getData('text/plain') ?? ''
        if (data.length > 0) selection.onReplaceRange(data)
        else selection.onRejectInput()
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
      onCompositionEnd={(event) => {
        composing.current = false
        clearColumn()
        // The composition commits once, here. A document selection is replaced
        // by the committed text; without one the normal change path applies it.
        if (selection?.active) applyDomInput(event.currentTarget.value)
      }}
      onDrop={(event) => {
        if (!selection?.active) return
        event.preventDefault()
        const data = event.dataTransfer.getData('text/plain')
        if (data.length > 0) selection.onReplaceRange(data)
        else selection.onRejectInput()
      }}
      onDragOver={(event) => {
        // A drop over a live selection is ours to handle; refusing the default
        // keeps the browser from inserting into one paragraph of the range.
        if (selection?.active) event.preventDefault()
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
        const arrow = arrowKey(event.key)
        const lineJump = event.key === 'Home' || event.key === 'End'
        const verticalKey =
          event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? event.key
            : null
        // Every key that is not a plain vertical arrow ends the column run.
        // Shift/Ctrl/Alt/Meta arrows keep their own rules below.
        if (!verticalKey) clearColumn()
        if (event.key === 'Escape') {
          if (selection?.active) {
            event.preventDefault()
            selection.onCollapse('focus')
            return
          }
          // With no live selection, Escape leaves the paragraph: the card's
          // second half. The draft is untouched, so no unsaved work is lost.
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
        // A modified arrow or a line jump would otherwise collapse the DOM
        // caret natively while the model still reported the range. Collapse
        // the model first, so the shortcut then runs from a caret the two
        // agree on; the platform shortcut is unchanged from that point.
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
        // An empty or text-less clipboard payload (an image-only copy, a
        // format-only clipboard) must not replace a live selection with an
        // empty string, which would read as an accidental delete. Whitespace
        // and newlines are meaningful text and pass the length check.
        const data = event.clipboardData?.getData('text/plain') ?? ''
        if (data.length > 0) selection.onReplaceRange(data)
        else selection.onRejectInput()
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
  // A single code point, not a single UTF-16 code unit: an astral character
  // such as an emoji is one printable key even though `length` is two.
  return [...event.key].length === 1
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
