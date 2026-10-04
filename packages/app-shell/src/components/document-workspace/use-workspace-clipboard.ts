import type { DocumentModelWire } from '@obiter/contracts'
import { documentStory } from '../../document-model-text'
import type { PasteTarget } from '../../document-paste'
import {
  selectionPlainText,
  type DocumentSelection,
  type SelectionEndpoint,
  type SelectionOrder,
} from '../../document-selection'
import type { WordEditOutcome } from '../../document-word-edits'
import type { SelectionRefusal } from './document-selection-notices'
import type { DocumentClipboardToolbar } from './ribbon-types'

/**
 * The ribbon's clipboard availability, built here so the flags, reasons and
 * handlers stay one derivation. Copy and cut need a live document selection;
 * paste needs an editable document.
 */
export function documentClipboardToolbar(input: {
  editable: boolean
  selectionActive: boolean
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}): DocumentClipboardToolbar {
  return {
    canCopy: input.selectionActive,
    canCut: input.selectionActive,
    canPaste: input.editable,
    copyReason: 'Select text to copy',
    cutReason: 'Select text to cut',
    ...(input.editable ? {} : { pasteReason: 'The document is read-only' }),
    onCopy: input.onCopy,
    onCut: input.onCut,
    onPaste: input.onPaste,
  }
}

export type ClipboardPlacement = { paragraphId: string; offset: number }

/**
 * The clipboard commands and the paste path, kept out of `useWorkspaceCaret`
 * (already near the source ceiling) but owning their own state only through the
 * seams it passes in. Copy and cut write the selection as `text/plain`; a cut
 * writes first and deletes only when the write succeeded, so a failed write
 * cannot lose text the clipboard never held. Paste applies the same pure
 * multi-paragraph splitter for the ribbon and the native paste event.
 */
export function useWorkspaceClipboard({
  model,
  selection,
  selectionActive,
  context,
  selectedRange,
  replaceSelection,
  selectedParagraphId,
  formatRange,
  restoreCaret,
  placeCaret,
  setRefusal,
  paste,
}: {
  model: DocumentModelWire | undefined
  selection: DocumentSelection | null
  selectionActive: boolean
  context: SelectionOrder
  selectedRange: () => {
    start: SelectionEndpoint
    end: SelectionEndpoint
  } | null
  replaceSelection: (text: string) => void
  selectedParagraphId: string | null
  formatRange: { from: number; to: number } | null
  restoreCaret: ClipboardPlacement | null
  placeCaret: (paragraphId: string, offset?: number) => void
  setRefusal: (refusal: SelectionRefusal | null) => void
  paste: (
    model: DocumentModelWire,
    target: PasteTarget,
    text: string,
  ) => WordEditOutcome | null
}) {
  /** Native copy event: the browser owns the clipboard, so this only fills it. */
  function copySelection(clipboard: DataTransfer | null) {
    if (!selection) return
    clipboard?.setData('text/plain', selectionPlainText(context, selection))
  }

  /** Native cut event: validate the range, then write before deleting, so a
   * refused edit cannot leave text in the clipboard that was never removed. */
  function cutSelection(clipboard: DataTransfer | null) {
    const range = selectedRange()
    if (!range || !selection) return
    if (!clipboard) {
      setRefusal('clipboard')
      return
    }
    try {
      clipboard.setData('text/plain', selectionPlainText(context, selection))
    } catch {
      setRefusal('clipboard')
      return
    }
    replaceSelection('')
  }

  async function copyToClipboard() {
    if (!selection) return
    const text = selectionPlainText(context, selection)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setRefusal('clipboard-copy')
    }
  }

  async function cutToClipboard() {
    const range = selectedRange()
    if (!range || !selection) return
    const text = selectionPlainText(context, selection)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setRefusal('clipboard')
      return
    }
    replaceSelection('')
  }

  function pasteTarget(offsets?: {
    from: number
    to: number
  }): PasteTarget | null {
    if (!model) return null
    if (selectionActive) {
      const range = selectedRange()
      if (!range) return null
      return { kind: 'range', from: range.start, to: range.end }
    }
    // The ribbon has no DOM caret, so it falls back to the workspace's own
    // record of where the caret is; a paragraph with neither pastes at its
    // start rather than being disabled.
    const paragraphId =
      selectedParagraphId ?? documentStory(model)?.paragraphs[0]?.id
    if (!paragraphId) return null
    const from = offsets?.from ?? formatRange?.from ?? restoreCaret?.offset ?? 0
    const to = offsets?.to ?? formatRange?.to ?? from
    return from === to
      ? { kind: 'caret', caret: { paragraphId, offset: from } }
      : {
          kind: 'range',
          from: { paragraphId, offset: from },
          to: { paragraphId, offset: to },
        }
  }

  function pasteText(text: string, offsets?: { from: number; to: number }) {
    if (!model) return
    const target = pasteTarget(offsets)
    if (!target) return
    const outcome = paste(model, target, text)
    if (outcome?.status === 'applied') {
      placeCaret(outcome.caret.paragraphId, outcome.caret.offset)
    } else if (outcome?.status === 'refused') {
      setRefusal(outcome.refusal)
    }
  }

  async function pasteFromClipboard() {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setRefusal('clipboard-read')
      return
    }
    if (text.length === 0) return
    pasteText(text)
  }

  return {
    copySelection,
    cutSelection,
    copyToClipboard,
    cutToClipboard,
    pasteText,
    pasteFromClipboard,
  }
}
