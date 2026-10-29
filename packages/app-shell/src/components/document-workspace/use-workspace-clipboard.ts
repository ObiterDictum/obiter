import type { DocumentModelWire } from '@obiter/contracts'
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
  firstParagraphId,
}: {
  model: DocumentModelWire | undefined
  selection: DocumentSelection | null
  selectionActive: boolean
  context: SelectionOrder
  selectedRange: () => {
    start: SelectionEndpoint
    end: SelectionEndpoint
  } | null
  replaceSelection: (
    text: string,
    range?: { start: SelectionEndpoint; end: SelectionEndpoint },
  ) => void
  selectedParagraphId: string | null
  selectionParagraphIds: ReadonlySet<string>
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
  firstParagraphId?: string
}) {
  function copySelection(clipboard: DataTransfer | null) {
    if (!selection) return
    clipboard?.setData('text/plain', selectionPlainText(context, selection))
  }

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
    replaceSelection('', range)
  }

  type PasteOffsets = { paragraphId: string; from: number; to: number }

  function pasteTarget(
    target?: PasteOffsets,
  ): PasteTarget | 'structure' | null {
    if (!model) return null
    if (
      selectionActive &&
      (target === undefined || selectionParagraphIds.has(target.paragraphId))
    ) {
      const range = selectedRange()
      if (!range) return null
      return { kind: 'range', from: range.start, to: range.end }
    }
    const paragraphId =
      target?.paragraphId ?? selectedParagraphId ?? firstParagraphId
    if (!paragraphId) return null
    if (isStructuralParagraph(paragraphId)) return 'structure'
    const from =
      target?.from ??
      (paragraphId === selectedParagraphId ? formatRange?.from : undefined) ??
      (restoreCaret?.paragraphId === paragraphId
        ? restoreCaret.offset
        : undefined) ??
      0
    const to =
      target?.to ??
      (paragraphId === selectedParagraphId ? formatRange?.to : undefined) ??
      from
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
