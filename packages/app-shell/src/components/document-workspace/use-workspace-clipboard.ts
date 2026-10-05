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
  selectionParagraphIds,
  isStructuralParagraph,
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
  /** The paragraphs a live document selection covers, so a paste can tell a
   * selection replacement from a paste into another (unfocused) paragraph. */
  selectionParagraphIds: ReadonlySet<string>
  /** Whether a paragraph is outside the body flow: a table cell or a text box.
   * Splitting a paste there would render siblings as body text. */
  isStructuralParagraph: (paragraphId: string) => boolean
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

  /** The paragraph and offsets a paste targets. Absent the ribbon, a field
   * hands its own paragraph and DOM selection. */
  type PasteOffsets = { paragraphId: string; from: number; to: number }

  function pasteTarget(
    target?: PasteOffsets,
  ): PasteTarget | 'structure' | null {
    if (!model) return null
    // A live document selection is the target unless the caller names a
    // paragraph it does not cover: a drop onto an unfocused pending insert must
    // land there, not in the selected paragraph.
    if (
      selectionActive &&
      (target === undefined || selectionParagraphIds.has(target.paragraphId))
    ) {
      const range = selectedRange()
      if (!range) return null
      return { kind: 'range', from: range.start, to: range.end }
    }
    // The ribbon has no DOM caret, so it falls back to the workspace's own
    // record of where the caret is; a paragraph with neither pastes at its
    // start rather than being disabled.
    const paragraphId =
      target?.paragraphId ??
      selectedParagraphId ??
      documentStory(model)?.paragraphs[0]?.id
    if (!paragraphId) return null
    // A split paste creates sibling paragraphs, which a table cell or a text
    // box cannot hold: the flow would render them as body text while the save
    // writes them inside the cell. Refuse with the selection's own structure
    // reason rather than producing edits the document cannot represent.
    if (isStructuralParagraph(paragraphId)) return 'structure'
    const from = target?.from ?? formatRange?.from ?? restoreCaret?.offset ?? 0
    const to = target?.to ?? formatRange?.to ?? from
    return from === to
      ? { kind: 'caret', caret: { paragraphId, offset: from } }
      : {
          kind: 'range',
          from: { paragraphId, offset: from },
          to: { paragraphId, offset: to },
        }
  }

  function pasteText(text: string, target?: PasteOffsets) {
    if (!model) return
    const resolved = pasteTarget(target)
    if (resolved === 'structure') {
      setRefusal('structure')
      return
    }
    if (!resolved) return
    const outcome = paste(model, resolved, text)
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
