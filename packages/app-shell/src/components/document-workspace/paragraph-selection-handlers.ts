import { useMemo } from 'react'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import type { useWorkspaceCaret } from './use-workspace-caret'
import { useLatestCallback } from './use-latest-callback'

type Caret = ReturnType<typeof useWorkspaceCaret>

export function useParagraphSelectionHandlers(
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
  const extend = useLatestCallback(caret.extendSelection)
  const collapse = useLatestCallback(caret.collapseSelection)
  const selectAll = useLatestCallback(caret.selectAll)
  const replaceRange = useLatestCallback(caret.replaceSelectionRange)
  const splitRange = useLatestCallback(caret.splitSelectionRange)
  const copy = useLatestCallback(caret.copySelection)
  const cut = useLatestCallback(caret.cutSelection)
  const paste = useLatestCallback(
    (paragraphId: string, text: string, from: number, to: number) =>
      caret.pasteText(text, { paragraphId, from, to }),
  )
  const clear = useLatestCallback(caret.clearSelection)
  const rejectInput = useLatestCallback(caret.rejectSelectionInput)
  const escapeBlur = useLatestCallback(caret.blurParagraph)
  return useMemo(
    () => ({
      active: caret.selectionActive,
      direction: caret.selectionDirection,
      onExtend: extend,
      onCollapse: collapse,
      onSelectAll: selectAll,
      onReplaceRange: replaceRange,
      onDeleteRange: () => replaceRange(''),
      onSplitRange: splitRange,
      onCopyRange: copy,
      onCutRange: cut,
      onPasteText: paste,
      onClear: clear,
      onRejectInput: rejectInput,
      onEscapeBlur: escapeBlur,
    }),
    [
      caret.selectionActive,
      caret.selectionDirection,
      extend,
      collapse,
      selectAll,
      replaceRange,
      splitRange,
      copy,
      cut,
      paste,
      clear,
      rejectInput,
      escapeBlur,
    ],
  )
}
