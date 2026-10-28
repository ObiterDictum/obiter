import type { ParagraphSelectionHandlers } from './paragraph-editor'
import type { useWorkspaceCaret } from './use-workspace-caret'

type Caret = ReturnType<typeof useWorkspaceCaret>

/**
 * The selection handlers a paragraph editor needs, mapped from the caret hook
 * that owns the selection. Kept out of the workspace component so the deeper
 * selection semantics live beside the hook that implements them.
 */
export function paragraphSelectionHandlers(
  caret: Pick<
    Caret,
    | 'selectionActive'
    | 'selectionDirection'
    | 'extendSelection'
    | 'collapseSelection'
    | 'selectAll'
    | 'replaceSelectionRange'
    | 'splitSelectionRange'
    | 'copySelection'
    | 'cutSelection'
    | 'pasteText'
    | 'clearSelection'
    | 'rejectSelectionInput'
    | 'blurParagraph'
  >,
): ParagraphSelectionHandlers {
  return {
    active: caret.selectionActive,
    direction: caret.selectionDirection,
    onExtend: caret.extendSelection,
    onCollapse: caret.collapseSelection,
    onSelectAll: caret.selectAll,
    onReplaceRange: caret.replaceSelectionRange,
    onDeleteRange: () => caret.replaceSelectionRange(''),
    onSplitRange: caret.splitSelectionRange,
    onCopyRange: caret.copySelection,
    onCutRange: caret.cutSelection,
    onPasteText: (paragraphId, text, from, to) =>
      caret.pasteText(text, { paragraphId, from, to }),
    onClear: caret.clearSelection,
    onRejectInput: caret.rejectSelectionInput,
    onEscapeBlur: caret.blurParagraph,
  }
}
