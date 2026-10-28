import { useLayoutEffect, useState } from 'react'
import { ChatText, Scales, TextB, TextItalic } from '@phosphor-icons/react'
import { EditorIconButton } from './editor-controls'
import type { DocumentFormatToolbar } from './ribbon-types'

/**
 * The toolbar that follows a text selection: the four things a reader most
 * often wants to do to a phrase without leaving it. It floats above the
 * selection and never takes the selection away — every control prevents the
 * pointer default, so the document keeps its range and the command lands on it.
 */
export function EditorSelectionToolbar({
  visible,
  format,
  canComment,
  onComment,
  onCite,
}: {
  visible: boolean
  format?: DocumentFormatToolbar
  canComment: boolean
  onComment: () => void
  onCite: () => void
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  )
  // The browser's selection rectangle is not React state: it changes on
  // pointer and key movement the document handles itself, so the toolbar reads
  // it from the selection and re-reads it when the selection moves.
  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null)
      return
    }
    const measure = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      // The test DOM has no layout: a range there reports no rectangle, so the
      // toolbar stays hidden rather than throwing on a method it lacks.
      if (typeof range.getBoundingClientRect !== 'function') return
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const above = rect.top > 56
      setPosition({
        left: Math.min(Math.max(8, rect.left + rect.width / 2 - 96), innerWidth - 200),
        top: above ? rect.top - 44 : rect.bottom + 8,
      })
    }
    measure()
    document.addEventListener('selectionchange', measure)
    return () => document.removeEventListener('selectionchange', measure)
  }, [visible])
  if (!visible || !position) return null
  const emphasisUnavailable = format?.emphasisUnavailable
  return (
    <div
      role="toolbar"
      aria-label="Selection tools"
      className="fixed z-30 flex items-center gap-1 rounded-md border border-line bg-raised px-1 py-1 shadow-lg"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <EditorIconButton
        label="Bold"
        pressed={format?.bold}
        disabled={!format || Boolean(emphasisUnavailable)}
        disabledReason={emphasisUnavailable}
        onClick={format?.onToggleBold}
        icon={<TextB size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Italic"
        pressed={format?.italic}
        disabled={!format || Boolean(emphasisUnavailable)}
        disabledReason={emphasisUnavailable}
        onClick={format?.onToggleItalic}
        icon={<TextItalic size={16} aria-hidden />}
      />
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <EditorIconButton
        label="Comment on selection"
        disabled={!canComment}
        disabledReason="Comments are not available on this document."
        onClick={onComment}
        icon={<ChatText size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Cite in document"
        onClick={onCite}
        icon={<Scales size={16} aria-hidden />}
      />
    </div>
  )
}
